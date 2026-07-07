const mongoose = require('mongoose');

const folderSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  folderName: {
    type: String,
    required: [true, 'Please provide a folder name'],
    trim: true,
    maxlength: [100, 'Folder name cannot be more than 100 characters']
  },
  color: {
    type: String,
    default: '#3B82F6'
  },
  icon: {
    type: String,
    default: 'folder'
  }
}, {
  timestamps: true
});

module.exports = mongoose.model('Folder', folderSchema);
