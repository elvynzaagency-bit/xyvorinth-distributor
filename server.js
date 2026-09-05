const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { execFile } = require('child_process');

const app = express();
const PORT = process.env.PORT || 3000;

const RELEASES_FILE = 'releases.json';

if (!fs.existsSync('public/uploads')) {
  fs.mkdirSync('public/uploads', { recursive: true });
}

if (!fs.existsSync(RELEASES_FILE)) {
  fs.writeFileSync(RELEASES_FILE, '[]');
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, 'public/uploads/');
  },

  filename: (req, file, cb) => {
    const safeName = file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_');
    cb(null, `${Date.now()}-${safeName}`);
  }
});


function createDistributionPackage(release) {
  const packageDir = path.join(
    __dirname,
    'distribution-packages',
    'ready',
    release.id
  );

  const packagesDir = path.join(__dirname, 'public', 'packages');

  fs.mkdirSync(packageDir, { recursive: true });
  fs.mkdirSync(packagesDir, { recursive: true });

  const audioSource = path.join(
    __dirname,
    'public',
    'uploads',
    release.audio.storedName
  );

  const coverSource = path.join(
    __dirname,
    'public',
    'uploads',
    release.cover.storedName
  );

  if (!fs.existsSync(audioSource)) {
    throw new Error('Audio file missing.');
  }

  if (!fs.existsSync(coverSource)) {
    throw new Error('Cover artwork missing.');
  }

  fs.copyFileSync(
    audioSource,
    path.join(packageDir, release.audio.originalName)
  );

  fs.copyFileSync(
    coverSource,
    path.join(packageDir, release.cover.originalName)
  );

  const metadata = {
    id: release.id,
    title: release.title,
    artist: release.artist,
    releaseType: release.releaseType,
    releaseDate: release.releaseDate,
    genre: release.genre,
    language: release.language,
    audio: release.audio.quality,
    artwork: {
      originalName: release.cover.originalName,
      size: release.cover.size
    }
  };

  fs.writeFileSync(
    path.join(packageDir, 'metadata.json'),
    JSON.stringify(metadata, null, 2)
  );

  const safeTitle = release.title.replace(/[^a-zA-Z0-9_-]/g, '_');
  const safeArtist = release.artist.replace(/[^a-zA-Z0-9_-]/g, '_');
  const zipName = `${safeTitle}-${safeArtist}.zip`;
  const zipPath = path.join(packagesDir, zipName);

  execFile(
    'zip',
    ['-r', zipPath, release.id],
    { cwd: path.join(__dirname, 'distribution-packages', 'ready') },
    (error) => {
      if (error) {
        console.error('❌ Package ZIP failed:', error.message);
      } else {
        console.log(`✅ Distribution ZIP created: ${zipName}`);
      }
    }
  );
}

const upload = multer({
  storage,

  fileFilter: (req, file, cb) => {
    if (file.fieldname === 'audio') {
      const ext = path.extname(file.originalname).toLowerCase();

      if (ext === '.flac' || ext === '.mp3') {
        return cb(null, true);
      }

      return cb(new Error('Audio must be FLAC or MP3 only.'));
    }

    if (file.fieldname === 'cover') {
      const ext = path.extname(file.originalname).toLowerCase();

      if (['.jpg', '.jpeg', '.png', '.webp'].includes(ext)) {
        return cb(null, true);
      }

      return cb(new Error('Cover must be JPG, PNG or WEBP.'));
    }

    cb(new Error('Invalid upload field.'));
  },

  limits: {
    fileSize: 200 * 1024 * 1024
  }
});

app.use(express.static('public'));

function checkAudioQuality(filePath, callback) {
  execFile(
    'ffprobe',
    [
      '-v', 'error',
      '-show_entries',
      'stream=codec_name,sample_rate,channels,bit_rate,bits_per_sample',
      '-of', 'json',
      filePath
    ],
    (error, stdout) => {
      if (error) {
        return callback(new Error('Invalid or unreadable audio file.'));
      }

      try {
        const data = JSON.parse(stdout);

        if (!data.streams || !data.streams.length) {
          return callback(new Error('No valid audio stream found.'));
        }

        const stream = data.streams[0];

        callback(null, {
          codec: stream.codec_name || null,
          sampleRate: Number(stream.sample_rate) || null,
          channels: Number(stream.channels) || null,
          bitrate: Number(stream.bit_rate) || null,
          bitDepth: Number(stream.bits_per_sample) || null
        });

      } catch {
        callback(new Error('Could not read audio information.'));
      }
    }
  );
}

function saveRelease(release) {
  const releases = JSON.parse(fs.readFileSync(RELEASES_FILE, 'utf8'));

  releases.push(release);

  fs.writeFileSync(
    RELEASES_FILE,
    JSON.stringify(releases, null, 2)
  );

}

app.post(
  '/api/upload',
  upload.fields([
    { name: 'audio', maxCount: 1 },
    { name: 'cover', maxCount: 1 }
  ]),
  (req, res) => {

    if (!req.files || !req.files.audio) {
      return res.status(400).json({
        success: false,
        message: 'Audio file is required.'
      });
    }

    const audioFile = req.files.audio[0];
    const coverFile = req.files.cover ? req.files.cover[0] : null;

    checkAudioQuality(audioFile.path, (error, quality) => {

      if (error) {
        fs.unlink(audioFile.path, () => {});

        if (coverFile) {
          fs.unlink(coverFile.path, () => {});
        }

        return res.status(400).json({
          success: false,
          message: error.message
        });
      }

      const ext = path.extname(audioFile.originalname).toLowerCase();

      if (quality.channels !== 2) {
        fs.unlink(audioFile.path, () => {});

        if (coverFile) {
          fs.unlink(coverFile.path, () => {});
        }

        return res.status(400).json({
          success: false,
          message: 'Audio must be stereo (2 channels).',
          quality
        });
      }

      if (quality.sampleRate !== 44100) {
        fs.unlink(audioFile.path, () => {});

        if (coverFile) {
          fs.unlink(coverFile.path, () => {});
        }

        return res.status(400).json({
          success: false,
          message: 'Audio sample rate must be 44.1 kHz.',
          quality
        });
      }

      if (
        ext === '.mp3' &&
        (!quality.bitrate || quality.bitrate < 320000)
      ) {
        fs.unlink(audioFile.path, () => {});

        if (coverFile) {
          fs.unlink(coverFile.path, () => {});
        }

        return res.status(400).json({
          success: false,
          message: 'MP3 bitrate must be at least 320 kbps.',
          quality
        });
      }

      const release = {
        id: `XYV-${Date.now()}`,

        title: req.body.title || '',
        artist: req.body.artist || '',
        releaseType: req.body.releaseType || '',
        releaseDate: req.body.releaseDate || '',
        genre: req.body.genre || '',
        language: req.body.language || '',

        audio: {
          originalName: audioFile.originalname,
          storedName: audioFile.filename,
          size: audioFile.size,
          format: ext.replace('.', ''),
          quality: quality
        },

        cover: coverFile
          ? {
              originalName: coverFile.originalname,
              storedName: coverFile.filename,
              size: coverFile.size
            }
          : null,

        status: 'Approved',

        uploadedAt: new Date().toISOString()
      };

      saveRelease(release);

      try {
        createDistributionPackage(release);
        console.log(`📦 Automatic package preparation started: ${release.id}`);
      } catch (error) {
        console.error(
          `❌ Automatic package preparation failed: ${release.id}`,
          error.message
        );
      }

      res.json({
        success: true,
        message: 'Release saved successfully.',
        release
      });
    });
  }
);


app.post('/api/releases/:id/status', express.json(), (req, res) => {
  const { status } = req.body;

  if (!['Approved', 'Rejected', 'Pending Review', 'Ready for Distribution', 'Distributed'].includes(status)) {
    return res.status(400).json({
      success: false,
      message: 'Invalid status.'
    });
  }

  const releases = JSON.parse(
    fs.readFileSync(RELEASES_FILE, 'utf8')
  );

  const release = releases.find(r => r.id === req.params.id);

  if (!release) {
    return res.status(404).json({
      success: false,
      message: 'Release not found.'
    });
  }

  release.status = status;
  release.statusUpdatedAt = new Date().toISOString();

  fs.writeFileSync(
    RELEASES_FILE,
    JSON.stringify(releases, null, 2)
  );

  if (status === 'Ready for Distribution') {
    try {
      createDistributionPackage(release);
      console.log(`📦 Automatic package preparation started: ${release.id}`);
    } catch (error) {
      console.error(`❌ Automatic package preparation failed: ${release.id}`, error.message);
    }
  }

  res.json({
    success: true,
    message: `Release status updated to ${status}.`,
    release
  });
});

app.get('/api/releases', (req, res) => {
  const releases = JSON.parse(
    fs.readFileSync(RELEASES_FILE, 'utf8')
  );

  res.json({
    success: true,
    releases
  });
});

app.use((err, req, res, next) => {
  console.error(err.message);

  res.status(400).json({
    success: false,
    message: err.message
  });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(
    `XYVORINTH Distributor: http://127.0.0.1:${PORT}`
  );
});

// ===============================
// ARTIST WALLET & PAYOUT SYSTEM
// ===============================

const WALLET_FILE = path.join(__dirname, 'wallet.json');

function loadWallet() {
  if (!fs.existsSync(WALLET_FILE)) {
    const wallet = {
      availableBalance: 0,
      pendingBalance: 0,
      minimumPayout: 10,
      currency: "USD",
      payouts: [],
      creditedRoyaltyIds: []
    };
    fs.writeFileSync(WALLET_FILE, JSON.stringify(wallet, null, 2));
    return wallet;
  }
  return JSON.parse(fs.readFileSync(WALLET_FILE, 'utf8'));
}

function saveWallet(wallet) {
  fs.writeFileSync(WALLET_FILE, JSON.stringify(wallet, null, 2));
}

app.get('/api/wallet', (req, res) => {
  try {
    res.json({ success: true, wallet: loadWallet() });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

app.post('/api/wallet/earnings', express.json(), (req, res) => {
  try {
    const amount = Number(req.body.amount);

    if (!Number.isFinite(amount) || amount <= 0) {
      return res.status(400).json({
        success: false,
        message: 'Invalid earnings amount.'
      });
    }

    const wallet = loadWallet();

    wallet.availableBalance = Number(
      (wallet.availableBalance + amount).toFixed(2)
    );

    saveWallet(wallet);

    res.json({
      success: true,
      message: 'Earnings added.',
      wallet
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
});

app.post('/api/wallet/payout', express.json(), (req, res) => {
  try {
    const wallet = loadWallet();
    const amount = Number(req.body.amount);

    if (!Number.isFinite(amount) || amount <= 0) {
      return res.status(400).json({
        success: false,
        message: 'Invalid payout amount.'
      });
    }

    if (amount < wallet.minimumPayout) {
      return res.status(400).json({
        success: false,
        message: `Minimum payout is ${wallet.minimumPayout} ${wallet.currency}.`
      });
    }

    if (amount > wallet.availableBalance) {
      return res.status(400).json({
        success: false,
        message: 'Insufficient available balance.'
      });
    }

    const payout = {
      id: `PAY-${Date.now()}`,
      amount: Number(amount.toFixed(2)),
      currency: wallet.currency,
      status: 'Processing',
      requestedAt: new Date().toISOString()
    };

    wallet.availableBalance = Number(
      (wallet.availableBalance - amount).toFixed(2)
    );

    wallet.payouts.unshift(payout);

    saveWallet(wallet);

    res.json({
      success: true,
      message: 'Payout request created.',
      payout,
      wallet
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
});

app.get('/api/wallet/payouts', (req, res) => {
  try {
    const wallet = loadWallet();

    res.json({
      success: true,
      payouts: wallet.payouts
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
});


// ===== ROYALTY & EARNINGS SYSTEM =====
const ROYALTIES_FILE = path.join(__dirname, 'royalties.json');

if (!fs.existsSync(ROYALTIES_FILE)) {
  fs.writeFileSync(ROYALTIES_FILE, '[]');
}

app.get('/api/royalties', (req, res) => {
  try {
    const royalties = JSON.parse(fs.readFileSync(ROYALTIES_FILE, 'utf8'));

    let streams = 0;
    let revenue = 0;
    const byPlatform = {};
    const byRelease = {};

    royalties.forEach(r => {
      streams += Number(r.streams) || 0;
      revenue += Number(r.revenue) || 0;

      const platform = r.platform || 'Unknown';
      byPlatform[platform] =
        (byPlatform[platform] || 0) + (Number(r.revenue) || 0);

      const release = r.releaseTitle || r.releaseId || 'Unknown';
      byRelease[release] =
        (byRelease[release] || 0) + (Number(r.revenue) || 0);
    });

    res.json({
      success: true,
      summary: {
        streams,
        revenue: Number(revenue.toFixed(4)),
        currency: 'USD',
        byPlatform,
        byRelease
      },
      records: royalties
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
});

app.post('/api/royalties/stream', express.json(), (req, res) => {
  try {
    const {
      releaseId,
      releaseTitle,
      platform,
      streams,
      revenue
    } = req.body;

    const streamCount = Number(streams);
    const revenueAmount = Number(revenue);

    if (
      !platform ||
      !Number.isFinite(streamCount) ||
      streamCount < 0 ||
      !Number.isFinite(revenueAmount) ||
      revenueAmount < 0
    ) {
      return res.status(400).json({
        success: false,
        message: 'Invalid royalty data.'
      });
    }

    const royalties = JSON.parse(
      fs.readFileSync(ROYALTIES_FILE, 'utf8')
    );

    const record = {
      id: `ROY-${Date.now()}`,
      releaseId: releaseId || null,
      releaseTitle: releaseTitle || 'Unknown Release',
      platform,
      streams: streamCount,
      revenue: Number(revenueAmount.toFixed(4)),
      currency: 'USD',
      recordedAt: new Date().toISOString()
    };

    royalties.push(record);

    fs.writeFileSync(
      ROYALTIES_FILE,
      JSON.stringify(royalties, null, 2)
    );

    // Automatically credit this royalty to the artist wallet.
    const wallet = loadWallet();

    if (!Array.isArray(wallet.creditedRoyaltyIds)) {
      wallet.creditedRoyaltyIds = [];
    }

    if (!wallet.creditedRoyaltyIds.includes(record.id)) {
      wallet.availableBalance = Number(
        (Number(wallet.availableBalance) + record.revenue).toFixed(2)
      );

      wallet.creditedRoyaltyIds.push(record.id);
      saveWallet(wallet);
    }

    res.json({
      success: true,
      message: 'Royalty record added and wallet credited.',
      record,
      wallet
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
});
