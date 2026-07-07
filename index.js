const express = require('express');
const path = require('path');
const axios = require('axios');

require('dotenv').config();

const app = express();

// ── Middleware ──────────────────────────────────────────────
app.use(express.json({ limit: '1mb' }));


// ── IPFS Relay Endpoint ────────────────────────────────────
// Securely proxies uploads to Pinata so API keys stay server-side.
app.post('/api/ipfs/upload', async (req, res) => {
  try {
    const data = req.body;

    if (!data || Object.keys(data).length === 0) {
      return res.status(400).json({ error: 'Request body is empty' });
    }

    const response = await axios.post(
      'https://api.pinata.cloud/pinning/pinJSONToIPFS',
      {
        pinataContent: data,
        pinataMetadata: {
          name: data._metadata_name || 'dvote-data'
        }
      },
      {
        headers: {
          'Content-Type': 'application/json',
          'pinata_api_key': process.env.PINATA_API_KEY,
          'pinata_secret_api_key': process.env.PINATA_SECRET_API_KEY
        }
      }
    );

    return res.json({ ipfsHash: response.data.IpfsHash });
  } catch (error) {
    console.error('Pinata upload error:', error.response?.data || error.message);
    return res.status(500).json({
      error: 'Failed to upload to IPFS',
      details: error.response?.data || error.message
    });
  }
});


// ── Candidate Queue (In-Memory) ────────────────────────────
let pendingCandidates = [];

// Get current queue
app.get('/api/ipfs/queue-candidate', (req, res) => {
  res.json({ queue: pendingCandidates });
});

// Add to queue
app.post('/api/ipfs/queue-candidate', (req, res) => {
  const candidate = req.body;
  if (!candidate || !candidate.name || !candidate.party) {
    return res.status(400).json({ error: 'Invalid candidate payload' });
  }
  
  // Assign a temporary ID
  candidate.tempId = Date.now().toString();
  pendingCandidates.push(candidate);
  
  res.json({ success: true, queue: pendingCandidates });
});

// Remove from queue (Approve/Reject)
app.post('/api/ipfs/queue-approve', (req, res) => {
  const { tempId } = req.body;
  pendingCandidates = pendingCandidates.filter(c => c.tempId !== tempId);
  res.json({ success: true, queue: pendingCandidates });
});

// ── Static Pages ───────────────────────────────────────────
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'src/html/login.html'));
});

app.get('/index.html', (req, res) => {
  res.sendFile(path.join(__dirname, 'src/html/index.html'));
});

app.get('/admin.html', (req, res) => {
  res.sendFile(path.join(__dirname, 'src/html/admin.html'));
});


// ── Static Assets ──────────────────────────────────────────
app.get('/css/index.css', (req, res) => {
  res.sendFile(path.join(__dirname, 'src/css/index.css'));
});

app.get('/assets/eth5.jpg', (req, res) => {
  res.sendFile(path.join(__dirname, 'src/assets/eth5.jpg'));
});

app.get('/dist/app.bundle.js', (req, res) => {
  res.sendFile(path.join(__dirname, 'src/dist/app.bundle.js'));
});

app.get('/dist/login.bundle.js', (req, res) => {
  res.sendFile(path.join(__dirname, 'src/dist/login.bundle.js'));
});

app.get('/js/login.js', (req, res) => {
  res.sendFile(path.join(__dirname, 'src/js/login.js'));
});

app.get('/js/app.js', (req, res) => {
  res.sendFile(path.join(__dirname, 'src/js/app.js'));
});

app.get('/favicon.ico', (req, res) => {
  res.sendFile(path.join(__dirname, 'public/favicon.ico'));
});


// ── Start Server ───────────────────────────────────────────
app.listen(8080, () => {
  console.log('Server listening on http://localhost:8080');
});
