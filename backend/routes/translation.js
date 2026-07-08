const express = require('express');
const { body, validationResult } = require('express-validator');
const Document = require('../models/Document');
const TranslationHistory = require('../models/TranslationHistory');
const { protect } = require('../middleware/auth');
const { SUPPORTED_LANGUAGES, isSupportedLanguage, translateHtml, translateText } = require('../utils/translate');

const router = express.Router();

// Helper function to count words and characters (matches routes/documents.js convention)
const countText = (text) => {
  if (!text) return { wordCount: 0, characterCount: 0 };
  const plainText = text.replace(/<[^>]*>/g, '');
  const words = plainText.trim().split(/\s+/).filter((word) => word.length > 0);
  return {
    wordCount: words.length,
    characterCount: plainText.length
  };
};

// @route   GET /api/translation/languages
// @desc    Get list of supported languages
// @access  Private
router.get('/languages', protect, (req, res) => {
  res.json({ success: true, languages: SUPPORTED_LANGUAGES });
});

// @route   GET /api/translation/history
// @desc    Get translation history for the current user
// @access  Private
router.get('/history', protect, async (req, res) => {
  try {
    const history = await TranslationHistory.find({ userId: req.user.id })
      .populate('sourceDocumentId', 'title documentType')
      .populate('translatedDocumentId', 'title documentType')
      .sort({ createdAt: -1 })
      .limit(50);

    res.json({ success: true, history });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// @route   POST /api/translation/translate
// @desc    Translate a document's title/content into a target language.
//          Creates a brand-new document (source document is left untouched)
//          with HTML formatting preserved, and links the two via translatedFrom.
// @access  Private
router.post('/translate', protect, [
  body('documentId').notEmpty().withMessage('documentId is required'),
  body('targetLanguage').notEmpty().withMessage('targetLanguage is required'),
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ success: false, errors: errors.array() });
  }

  const { documentId, targetLanguage } = req.body;
  const sourceLanguage = req.body.sourceLanguage || 'en';

  if (!isSupportedLanguage(targetLanguage)) {
    return res.status(400).json({ success: false, message: 'Unsupported target language' });
  }
  if (sourceLanguage !== 'auto' && !isSupportedLanguage(sourceLanguage)) {
    return res.status(400).json({ success: false, message: 'Unsupported source language' });
  }
  if (sourceLanguage === targetLanguage) {
    return res.status(400).json({ success: false, message: 'Source and target languages must be different' });
  }

  const sourceDocument = await Document.findOne({ _id: documentId, userId: req.user.id });
  if (!sourceDocument) {
    return res.status(404).json({ success: false, message: 'Document not found' });
  }

  // Create the history record up front so failures are visible in the history list too
  const historyEntry = await TranslationHistory.create({
    userId: req.user.id,
    sourceDocumentId: sourceDocument._id,
    sourceLanguage,
    targetLanguage,
    status: 'pending'
  });

  try {
    // MyMemory expects a real language code for the source, not "auto" - default to English
    const effectiveSourceLang = sourceLanguage === 'auto' ? 'en' : sourceLanguage;

    const [translatedTitle, translatedContent] = await Promise.all([
      translateText(sourceDocument.title, targetLanguage, effectiveSourceLang),
      translateHtml(sourceDocument.content, targetLanguage, effectiveSourceLang)
    ]);

    const counts = countText(translatedContent);

    const translatedDocument = await Document.create({
      userId: req.user.id,
      title: translatedTitle || `${sourceDocument.title} (${targetLanguage.toUpperCase()})`,
      description: sourceDocument.description,
      content: translatedContent,
      documentType: sourceDocument.documentType,
      folderId: sourceDocument.folderId,
      language: targetLanguage,
      translatedFrom: sourceDocument._id,
      ...counts
    });

    historyEntry.status = 'completed';
    historyEntry.translatedDocumentId = translatedDocument._id;
    await historyEntry.save();

    res.status(201).json({ success: true, document: translatedDocument });
  } catch (error) {
    console.error('Translation failed:', error);
    historyEntry.status = 'failed';
    historyEntry.errorMessage = error.message;
    await historyEntry.save();
    res.status(500).json({ success: false, message: 'Translation failed' });
  }
});

module.exports = router;
