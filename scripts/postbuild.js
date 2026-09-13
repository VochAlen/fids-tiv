const fs = require('fs');
const path = require('path');

function copyRecursive(src, dest) {
  if (!fs.existsSync(src)) {
    console.log(`⚠️  Preskačem (ne postoji): ${src}`);
    return;
  }
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const srcPath  = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      copyRecursive(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

copyRecursive('public',       '.next/standalone/public');
copyRecursive('.next/static', '.next/standalone/.next/static');
copyRecursive('data',         '.next/standalone/data');

console.log('✅ Postbuild kopiranje završeno');