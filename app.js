require('dotenv').config({ path: './backend/.env' });
const app = require('./backend/server');
const path = require('path');
const express = require('express');

const PORT = process.env.PORT || 8001;

// Serve frontend build in production
if (process.env.NODE_ENV === 'production') {
  app.use(express.static(path.join(__dirname, 'frontend', 'dist')));
  app.get('*', (req, res) => {
    if (!req.path.startsWith('/api')) {
      res.sendFile(path.join(__dirname, 'frontend', 'dist', 'index.html'));
    }
  });
}

app.listen(PORT, () => {
  console.log(`[VPC] Server running on port ${PORT}`);
  console.log(`[VPC] Environment: ${process.env.NODE_ENV || 'development'}`);
});
