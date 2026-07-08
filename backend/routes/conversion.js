const express = require('express');
const { PDFDocument, rgb, StandardFonts } = require('pdf-lib');
const { body, validationResult } = require('express-validator');
const Document = require('../models/Document');
const ConversionHistory = require('../models/ConversionHistory');
const cloudinary = require('../config/cloudinary');
const { protect } = require('../middleware/auth');

const router = express.Router();

// @route   GET /api/conversion/history
// @desc    Get conversion history
// @access  Private
router.get('/history', protect, async (req, res) => {
  try {
    const history = await ConversionHistory.find({ userId: req.user.id })
      .populate('documentId', 'title')
      .sort({ createdAt: -1 });

    res.json({ success: true, history });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// @route   POST /api/conversion/convert
// @desc    Convert document to another format
// @access  Private
router.post('/convert', protect, [
  body('documentId').notEmpty().withMessage('Document ID is required'),
  body('targetFormat').notEmpty().withMessage('Target format is required')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ success: false, errors: errors.array() });
    }

    const { documentId, targetFormat } = req.body;

    const supportedFormats = ['pdf', 'txt', 'html', 'markdown'];
    if (!supportedFormats.includes(targetFormat)) {
      return res.status(400).json({
        success: false,
        message: `Unsupported target format. Supported formats: ${supportedFormats.join(', ')}`
      });
    }

    const document = await Document.findOne({
      _id: documentId,
      userId: req.user.id
    });

    if (!document) {
      return res.status(404).json({ success: false, message: 'Document not found' });
    }

    // Create conversion history entry
    const conversion = await ConversionHistory.create({
      userId: req.user.id,
      documentId,
      originalFormat: document.documentType,
      convertedFormat: targetFormat,
      status: 'pending'
    });

    // Perform conversion based on target format
    let convertedBuffer;
    let fileName = `${document.title}.${targetFormat}`;

    try {
      switch (targetFormat) {
        case 'pdf':
          convertedBuffer = await convertToPDF(document);
          break;
        case 'txt':
          convertedBuffer = await convertToTXT(document);
          break;
        case 'html':
          convertedBuffer = await convertToHTML(document);
          break;
        case 'markdown':
          convertedBuffer = await convertToMarkdown(document);
          break;
        default:
          throw new Error('Unsupported target format');
      }

      // Upload converted file to Cloudinary
      const result = await new Promise((resolve, reject) => {
        cloudinary.uploader.upload_stream(
          {
            folder: 'converted',
            resource_type: 'auto',
            public_id: `converted_${conversion._id}`,
            format: targetFormat
          },
          (error, result) => {
            if (error) reject(error);
            else resolve(result);
          }
        ).end(convertedBuffer);
      });

      // Update conversion history
      conversion.convertedUrl = result.secure_url;
      conversion.cloudinaryPublicId = result.public_id;
      conversion.fileSize = convertedBuffer.length;
      conversion.status = 'completed';
      await conversion.save();

      res.json({
        success: true,
        conversion,
        downloadUrl: result.secure_url
      });
    } catch (conversionError) {
      console.error(conversionError);
      conversion.status = 'failed';
      conversion.errorMessage = conversionError.message;
      await conversion.save();
      res.status(500).json({
        success: false,
        message: 'Conversion failed',
        error: conversionError.message
      });
    }
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// Helper functions for conversion
async function convertToPDF(document) {
  const pdfDoc = await PDFDocument.create();
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica); // required by pdf-lib before drawText

  const pageWidth = 595.28; // A4
  const pageHeight = 841.89;
  const margin = 50;
  const fontSize = 12;
  const lineHeight = fontSize * 1.4;
  const maxWidth = pageWidth - margin * 2;

  const rawText = (document.content || '').replace(/<[^>]*>/g, '').trim() || document.title || 'Untitled Document';

  // Wrap text into lines that fit the page width
  const words = rawText.split(/\s+/);
  const lines = [];
  let currentLine = '';
  words.forEach((word) => {
    const testLine = currentLine ? `${currentLine} ${word}` : word;
    const testWidth = font.widthOfTextAtSize(testLine, fontSize);
    if (testWidth > maxWidth && currentLine) {
      lines.push(currentLine);
      currentLine = word;
    } else {
      currentLine = testLine;
    }
  });
  if (currentLine) lines.push(currentLine);

  // Paginate
  let page = pdfDoc.addPage([pageWidth, pageHeight]);
  let y = pageHeight - margin;

  lines.forEach((line) => {
    if (y < margin) {
      page = pdfDoc.addPage([pageWidth, pageHeight]);
      y = pageHeight - margin;
    }
    page.drawText(line, {
      x: margin,
      y,
      size: fontSize,
      font,
      color: rgb(0, 0, 0),
    });
    y -= lineHeight;
  });

  return await pdfDoc.save();
}

async function convertToTXT(document) {
  const text = document.content.replace(/<[^>]*>/g, '') || document.title;
  return Buffer.from(text, 'utf-8');
}

async function convertToHTML(document) {
  const html = document.content || `<h1>${document.title}</h1><p>Empty document</p>`;
  return Buffer.from(html, 'utf-8');
}

async function convertToMarkdown(document) {
  // Simple HTML to Markdown conversion
  let markdown = document.content || `# ${document.title}\n\n`;
  markdown = markdown
    .replace(/<h1>/g, '# ')
    .replace(/<\/h1>/g, '\n\n')
    .replace(/<h2>/g, '## ')
    .replace(/<\/h2>/g, '\n\n')
    .replace(/<h3>/g, '### ')
    .replace(/<\/h3>/g, '\n\n')
    .replace(/<strong>/g, '**')
    .replace(/<\/strong>/g, '**')
    .replace(/<b>/g, '**')
    .replace(/<\/b>/g, '**')
    .replace(/<em>/g, '*')
    .replace(/<\/em>/g, '*')
    .replace(/<i>/g, '*')
    .replace(/<\/i>/g, '*')
    .replace(/<p>/g, '')
    .replace(/<\/p>/g, '\n\n')
    .replace(/<br>/g, '\n')
    .replace(/<[^>]*>/g, '');
  
  return Buffer.from(markdown, 'utf-8');
}

module.exports = router;
