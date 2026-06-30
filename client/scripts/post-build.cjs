const fs = require('fs-extra');
const crypto = require('node:crypto');
const path = require('node:path');

const MANIFEST_FILENAME = '.librechat-client-dist-manifest.json';
const DEPLOYMENT_POLICY = 'complete-built-client-dist-v1';

async function listFiles(directory, rootDirectory = directory) {
  const entries = await fs.readdir(directory, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const absolutePath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await listFiles(absolutePath, rootDirectory)));
    } else {
      files.push(path.relative(rootDirectory, absolutePath));
    }
  }

  return files;
}

async function createDeploymentManifest() {
  const distDirectory = path.resolve('dist');
  const manifestPath = path.join(distDirectory, MANIFEST_FILENAME);
  await fs.remove(manifestPath);

  const files = (await listFiles(distDirectory)).sort();
  const hashes = {};
  for (const file of files) {
    const contents = await fs.readFile(path.join(distDirectory, file));
    hashes[file] = crypto.createHash('sha256').update(contents).digest('hex');
  }

  await fs.writeJson(
    manifestPath,
    {
      deploymentPolicy: DEPLOYMENT_POLICY,
      generatedAt: new Date().toISOString(),
      files: hashes,
    },
    { spaces: 2 },
  );
}

async function postBuild() {
  try {
    await fs.copy('public/assets', 'dist/assets');
    await fs.copy('public/robots.txt', 'dist/robots.txt');
    await createDeploymentManifest();
    console.log('✅ PWA icons and robots.txt copied successfully. Glob pattern warnings resolved.');
    console.log(`✅ Wrote ${MANIFEST_FILENAME} for full-dist deployment verification.`);
  } catch (err) {
    console.error('❌ Error copying files:', err);
    process.exit(1);
  }
}

postBuild();
