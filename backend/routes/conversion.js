const express = require('express');
const { PDFDocument, rgb } = require('pdf-lib');
const mammoth = require('mammoth');
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
  const page = pdfDoc.addPage([595.28, 841.89]); // A4 size

  // Simple text conversion - in production, use a proper HTML to PDF library
  const text = document.content.replace(/<[^>]*>/g, '') || document.title;
  page.drawText(text.substring(0, 3000), {
    x: 50,
    y: 750,
    size: 12,
    color: rgb(0, 0, 0),
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
