
async function getBinaryFile(url: string): Promise<Uint8Array> {
    const response = await fetch(url);
    if (!response.ok) {
        throw new Error(`Invalid HTTP response, ${response.status}: ${response.statusText}`);
    }
    const buffer = await response.arrayBuffer();
    return new Uint8Array(buffer);
}

export function getApprovalProgram(): Promise<Uint8Array> {
    return getBinaryFile('/approval_program.teal.tok');
}

export function getClearProgram(): Promise<Uint8Array> {
    return getBinaryFile('/clear_state_program.teal.tok');
}
