import sharp from 'sharp';
import fs from 'node:fs';
fs.mkdirSync('build', { recursive: true });
await sharp('../assets/icon.svg', { density: 384 }).resize(512, 512, { fit: 'contain', background: '#ffffff' }).png().toFile('build/icon.png');
