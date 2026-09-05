const fs = require('fs');
const path = require('path');

const RELEASES_FILE = path.join(__dirname, 'releases.json');
const UPLOADS_DIR = path.join(__dirname, 'public', 'uploads');
const READY_DIR = path.join(__dirname, 'distribution-packages', 'ready');

const releases = JSON.parse(fs.readFileSync(RELEASES_FILE, 'utf8'));

const approved = releases.filter(r => r.status === 'Approved');

if (approved.length === 0) {
  console.log('❌ No Approved releases found.');
  process.exit(0);
}

for (const release of approved) {
  const packageDir = path.join(READY_DIR, release.id);

  fs.mkdirSync(packageDir, { recursive: true });

  const audioSource = path.join(UPLOADS_DIR, release.audio.storedName);
  const coverSource = path.join(UPLOADS_DIR, release.cover.storedName);

  if (!fs.existsSync(audioSource)) {
    console.log(`❌ Audio missing: ${release.id}`);
    continue;
  }

  if (!fs.existsSync(coverSource)) {
    console.log(`❌ Cover missing: ${release.id}`);
    continue;
  }

  fs.copyFileSync(audioSource, path.join(packageDir, release.audio.originalName));
  fs.copyFileSync(coverSource, path.join(packageDir, release.cover.originalName));

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

  console.log(`✅ Package prepared: ${release.id}`);
}

console.log('\n📦 Distribution package preparation complete.');
