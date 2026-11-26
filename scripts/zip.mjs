// Minimal ZIP writer (deflate) using only node:zlib — enough for browser-extension packages.
import zlib from 'node:zlib';

const DOS_TIME = 0, DOS_DATE = (1 << 5) | 1; // fixed 1980-01-01 so builds are reproducible

/** @param {{name:string,data:Buffer}[]} files */
export function zip(files) {
  const locals = [], centrals = [];
  let offset = 0;
  for (const f of [...files].sort((a, b) => a.name.localeCompare(b.name, 'en'))) {
    const name = Buffer.from(f.name.replace(/\\/g, '/'), 'utf8');
    const data = zlib.deflateRawSync(f.data, { level: 9 });
    const crc = zlib.crc32(f.data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(0x0800, 6); local.writeUInt16LE(8, 8);
    local.writeUInt16LE(DOS_TIME, 10); local.writeUInt16LE(DOS_DATE, 12); local.writeUInt32LE(crc >>> 0, 14);
    local.writeUInt32LE(data.length, 18); local.writeUInt32LE(f.data.length, 22); local.writeUInt16LE(name.length, 26); local.writeUInt16LE(0, 28);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(20, 4); central.writeUInt16LE(20, 6); central.writeUInt16LE(0x0800, 8); central.writeUInt16LE(8, 10);
    central.writeUInt16LE(DOS_TIME, 12); central.writeUInt16LE(DOS_DATE, 14); central.writeUInt32LE(crc >>> 0, 16);
    central.writeUInt32LE(data.length, 20); central.writeUInt32LE(f.data.length, 24); central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(offset, 42);
    locals.push(local, name, data);
    centrals.push(central, name);
    offset += local.length + name.length + data.length;
  }
  const cd = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(files.length, 8); end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, end]);
}
