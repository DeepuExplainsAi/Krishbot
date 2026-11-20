import fs from 'node:fs/promises';
import path from 'node:path';
/** This computer's disk. Agents run their own commands; the app only reads and writes files. */
export const box = {
    async writeFile(file, content) {
        await fs.mkdir(path.dirname(file), { recursive: true });
        await fs.writeFile(file, typeof content === 'string' ? Buffer.from(content, 'utf8') : content);
    },
    /** Read a file, or null if it isn't there. */
    async readFile(file) {
        try {
            return await fs.readFile(file);
        }
        catch {
            return null;
        }
    },
};
//# sourceMappingURL=box.js.map