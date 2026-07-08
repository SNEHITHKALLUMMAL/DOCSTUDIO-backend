# DocForge Backend

Backend API for DocForge - Document Management System

## Setup

1. Install dependencies:
```bash
npm install
```

2. Create `.env` file:
```env
PORT=5000
MONGODB_URI=mongodb://localhost:27017/docforge
JWT_SECRET=your_jwt_secret_key_here
JWT_EXPIRE=7d

CLOUDINARY_CLOUD_NAME=your_cloud_name
CLOUDINARY_API_KEY=your_api_key
CLOUDINARY_API_SECRET=your_api_secret

NODE_ENV=development
```

3. Start the server:
```bash
npm run dev
```

The API will be available at `http://localhost:5000`

## API Endpoints

See main README.md for complete API documentation.
