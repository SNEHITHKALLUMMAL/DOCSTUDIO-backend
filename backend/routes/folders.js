const express = require('express');
const { body, validationResult } = require('express-validator');
const Folder = require('../models/Folder');
const Document = require('../models/Document');
const { protect } = require('../middleware/auth');

const router = express.Router();

// @route   GET /api/folders
// @desc    Get all folders for a user
// @access  Private
router.get('/', protect, async (req, res) => {
  try {
    const folders = await Folder.find({ userId: req.user.id }).sort({ createdAt: -1 });

    // Get document count for each folder
    const foldersWithCount = await Promise.all(
      folders.map(async (folder) => {
        const count = await Document.countDocuments({
          folderId: folder._id,
          userId: req.user.id,
          isDeleted: false
        });
        return {
          ...folder.toObject(),
          documentCount: count
        };
      })
    );

    res.json({ success: true, folders: foldersWithCount });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// @route   GET /api/folders/:id
// @desc    Get single folder
// @access  Private
router.get('/:id', protect, async (req, res) => {
  try {
    const folder = await Folder.findOne({
      _id: req.params.id,
      userId: req.user.id
    });

    if (!folder) {
      return res.status(404).json({ success: false, message: 'Folder not found' });
    }

    const documents = await Document.find({
      folderId: req.params.id,
      userId: req.user.id,
      isDeleted: false
    }).sort({ updatedAt: -1 });

    res.json({ success: true, folder, documents });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// @route   POST /api/folders
// @desc    Create new folder
// @access  Private
router.post('/', protect, [
  body('folderName').trim().notEmpty().withMessage('Folder name is required')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ success: false, errors: errors.array() });
    }

    const { folderName, color, icon } = req.body;

    const folder = await Folder.create({
      userId: req.user.id,
      folderName,
      color: color || '#3B82F6',
      icon: icon || 'folder'
    });

    res.status(201).json({ success: true, folder });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// @route   PUT /api/folders/:id
// @desc    Update folder
// @access  Private
router.put('/:id', protect, async (req, res) => {
  try {
    const folder = await Folder.findOne({
      _id: req.params.id,
      userId: req.user.id
    });

    if (!folder) {
      return res.status(404).json({ success: false, message: 'Folder not found' });
    }

    const { folderName, color, icon } = req.body;
    const updateData = {};

    if (folderName !== undefined) updateData.folderName = folderName;
    if (color !== undefined) updateData.color = color;
    if (icon !== undefined) updateData.icon = icon;

    const updatedFolder = await Folder.findByIdAndUpdate(
      req.params.id,
      updateData,
      { new: true }
    );

    res.json({ success: true, folder: updatedFolder });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// @route   DELETE /api/folders/:id
// @desc    Delete folder
// @access  Private
router.delete('/:id', protect, async (req, res) => {
  try {
    const folder = await Folder.findOne({
      _id: req.params.id,
      userId: req.user.id
    });

    if (!folder) {
      return res.status(404).json({ success: false, message: 'Folder not found' });
    }

    // Move documents to root (remove folderId)
    await Document.updateMany(
      { folderId: req.params.id, userId: req.user.id },
      { folderId: null }
    );

    await Folder.findByIdAndDelete(req.params.id);

    res.json({ success: true, message: 'Folder deleted successfully' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

module.exports = router;
