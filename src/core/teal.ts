import { readFile } from 'fs';
import { join } from 'path';

function readBinaryFile(filename: string): Promise<Uint8Array> {
    return new Promise((resolve, reject) => {
        readFile(filename, (err, content) => {
            if (err) {
                reject(err);
            } else {
                resolve(new Uint8Array(content));
            }
        });
    });
}

export function getApprovalProgram(): Promise<Uint8Array> {
    const file = join(__dirname, '..', '..', 'game_approval.teal.tok');
    return readBinaryFile(file);
}

export function getClearProgram(): Promise<Uint8Array> {
    const file = join(__dirname, '..', '..', 'game_close_out.teal.tok');
    return readBinaryFile(file);
}
