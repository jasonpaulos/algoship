import { readFile } from 'fs/promises';
import { fileURLToPath } from 'url';
import { join } from 'path';

const currentFilename = fileURLToPath(import.meta.url);

async function readBinaryFile(filename: string): Promise<Uint8Array> {
    const contents = await readFile(filename);
    return new Uint8Array(contents);
}

export function getApprovalProgram(): Promise<Uint8Array> {
    const file = join(currentFilename, '..', '..', '..', 'game_approval.teal.tok');
    return readBinaryFile(file);
}

export function getClearProgram(): Promise<Uint8Array> {
    const file = join(currentFilename, '..', '..', '..', 'game_close_out.teal.tok');
    return readBinaryFile(file);
}
