const express = require('express');
const { body, validationResult } = require('express-validator');
const Document = require('../models/Document');
const cloudinary = require('../config/cloudinary');
const { protect } = require('../middleware/auth');
const upload = require('../middleware/upload');

const router = express.Router();

// Helper function to count words and characters
const countText = (text) => {
  if (!text) return { wordCount: 0, characterCount: 0 };
  const plainText = text.replace(/<[^>]*>/g, '');
  const words = plainText.trim().split(/\s+/).filter(word => word.length > 0);
  return {
    wordCount: words.length,
    characterCount: plainText.length
  };
};

// @route   GET /api/documents
// @desc    Get all documents for a user
// @access  Private
router.get('/', protect, async (req, res) => {
  try {
    const { folder, search, favorite, trash } = req.query;
    const query = { userId: req.user.id };

    if (folder) {
      query.folderId = folder;
    }

    if (favorite === 'true') {
      query.isFavorite = true;
    }

    if (trash === 'true') {
      query.isDeleted = true;
    } else {
      query.isDeleted = false;
    }

    if (search) {
      query.$or = [
        { title: { $regex: search, $options: 'i' } },
        { description: { $regex: search, $options: 'i' } }
      ];
    }

    const documents = await Document.find(query)
      .populate('folderId', 'folderName color')
      .sort({ updatedAt: -1 });

    res.json({ success: true, documents });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// @route   GET /api/documents/:id
// @desc    Get single document
// @access  Private
router.get('/:id', protect, async (req, res) => {
  try {
    const document = await Document.findOne({
      _id: req.params.id,
      userId: req.user.id
    }).populate('folderId', 'folderName color');

    if (!document) {
      return res.status(404).json({ success: false, message: 'Document not found' });
    }

    res.json({ success: true, document });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// @route   POST /api/documents
// @desc    Create new document
// @access  Private
router.post('/', protect, [
  body('title').trim().notEmpty().withMessage('Title is required')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ success: false, errors: errors.array() });
    }

    const { title, description, content, documentType, folderId } = req.body;

    const counts = countText(content);

    const document = await Document.create({
      userId: req.user.id,
      title,
      description,
      content: content || '',
      documentType: documentType || 'docx',
      folderId: folderId || null,
      ...counts
    });

    res.status(201).json({ success: true, document });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// @route   PUT /api/documents/:id
// @desc    Update document
// @access  Private
router.put('/:id', protect, async (req, res) => {
  try {
    const document = await Document.findOne({
      _id: req.params.id,
      userId: req.user.id
    });

    if (!document) {
      return res.status(404).json({ success: false, message: 'Document not found' });
    }

    const { title, description, content, folderId, isFavorite } = req.body;
    const updateData = {};

    if (title !== undefined) updateData.title = title;
    if (description !== undefined) updateData.description = description;
    if (content !== undefined) {
      updateData.content = content;
      const counts = countText(content);
      updateData.wordCount = counts.wordCount;
      updateData.characterCount = counts.characterCount;
    }
    if (folderId !== undefined) updateData.folderId = folderId;
    if (isFavorite !== undefined) updateData.isFavorite = isFavorite;

    const updatedDocument = await Document.findByIdAndUpdate(
      req.params.id,
      updateData,
      { new: true }
    ).populate('folderId', 'folderName color');

    res.json({ success: true, document: updatedDocument });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// @route   POST /api/documents/upload
// @desc    Upload document
// @access  Private
router.post('/upload', protect, upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, message: 'No file uploaded' });
    }

    const { title, description, folderId } = req.body;

    // Upload to Cloudinary
    const result = await new Promise((resolve, reject) => {
      cloudinary.uploader.upload_stream(
        {
          folder: 'documents',
          resource_type: 'auto',
          allowed_formats: ['pdf', 'docx', 'txt', 'html', 'md', 'rtf']
        },
        (error, result) => {
          if (error) reject(error);
          else resolve(result);
        }
      ).end(req.file.buffer);
    });

    // Determine document type from original file
    const documentType = req.file.originalname.split('.').pop().toLowerCase();

    const document = await Document.create({
      userId: req.user.id,
      title: title || req.file.originalname,
      description: description || '',
      documentType,
      cloudinaryPublicId: result.public_id,
      cloudinaryUrl: result.secure_url,
      fileSize: req.file.size,
      folderId: folderId || null
    });

    // Update user storage
    const User = require('../models/User');
    await User.findByIdAndUpdate(req.user.id, {
      $inc: { storageUsed: req.file.size }
    });

    res.status(201).json({ success: true, document });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// @route   PUT /api/documents/:id/favorite
// @desc    Toggle favorite
// @access  Private
router.put('/:id/favorite', protect, async (req, res) => {
  try {
    const document = await Document.findOne({
      _id: req.params.id,
      userId: req.user.id
    });

    if (!document) {
      return res.status(404).json({ success: false, message: 'Document not found' });
    }

    document.isFavorite = !document.isFavorite;
    await document.save();

    res.json({ success: true, document });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// @route   PUT /api/documents/:id/restore
// @desc    Restore document from trash
// @access  Private
router.put('/:id/restore', protect, async (req, res) => {
  try {
    const document = await Document.findOne({
      _id: req.params.id,
      userId: req.user.id
    });

    if (!document) {
      return res.status(404).json({ success: false, message: 'Document not found' });
    }

    document.isDeleted = false;
    document.deletedAt = null;
    await document.save();

    res.json({ success: true, document });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// @route   DELETE /api/documents/:id
// @desc    Delete document (soft delete)
// @access  Private
router.delete('/:id', protect, async (req, res) => {
  try {
    const document = await Document.findOne({
      _id: req.params.id,
      userId: req.user.id
    });

    if (!document) {
      return res.status(404).json({ success: false, message: 'Document not found' });
    }

    // Soft delete
    document.isDeleted = true;
    document.deletedAt = Date.now();
    await document.save();

    res.json({ success: true, message: 'Document moved to trash' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// @route   DELETE /api/documents/:id/permanent
// @desc    Permanently delete document
// @access  Private
router.delete('/:id/permanent', protect, async (req, res) => {
  try {
    const document = await Document.findOne({
      _id: req.params.id,
      userId: req.user.id
    });

    if (!document) {
      return res.status(404).json({ success: false, message: 'Document not found' });
    }

    // Delete from Cloudinary
    if (document.cloudinaryPublicId) {
      await cloudinary.uploader.destroy(document.cloudinaryPublicId);
    }

    // Update user storage
    const User = require('../models/User');
    await User.findByIdAndUpdate(req.user.id, {
      $inc: { storageUsed: -document.fileSize }
    });

    await Document.findByIdAndDelete(req.params.id);

    res.json({ success: true, message: 'Document permanently deleted' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

module.exports = router;
