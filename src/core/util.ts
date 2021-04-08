import { randomBytes } from 'crypto';
import algosdk from 'algosdk';
import sha512 from 'js-sha512';

export async function* trackRounds(client: algosdk.Algodv2) {
    let lastStatus = await client.status().do();
    let lastRound = lastStatus['last-round'];
    while (true) {
        yield lastRound;
        lastRound++
        await client.statusAfterBlock(lastRound).do();
    }
}

export async function waitForTransaction(client: algosdk.Algodv2, txId: string): Promise<Record<string, any>> {
    let lastStatus = await client.status().do();
    let lastRound = lastStatus['last-round'];
    while (true) {
        const status = await client.pendingTransactionInformation(txId).do();
        if (status['pool-error']) {
            throw new Error(`Transaction Pool Error: ${status['pool-error']}`);
        }
        if (status['confirmed-round']) {
            return status;
        }
        lastStatus = await client.statusAfterBlock(lastRound + 1).do();
        lastRound = lastStatus['last-round'];
    }
}

export function decodeState(stateArray: any[]) {
    const state: {[key: string]: string | number} = {};

    for (const pair of stateArray) {
        const key = pair.key;
        let value;

        if (pair.value.type == 2) {
            // value is uint64
            value = pair.value.uint;
        } else {
            // value is byte array
            value = pair.value.bytes;
        }

        state[key] = value;
    }

    return state;
}

export async function readLocalState(client: algosdk.Algodv2, appId: number, account: string): Promise<{[key: string]: string | number} | undefined> {
    const ai = await client.accountInformation(account).do();
    for (const app of ai['apps-local-state']) {
        if (app.id == appId) {
            return decodeState(app['key-value']);
        }
    }
}

export async function readGlobalState(client: algosdk.Algodv2, appId: number): Promise<{[key: string]: string | number}> {
    const app = await client.getApplicationByID(appId).do();
    return decodeState(app.params['global-state']);
}

export async function generateSecret(): Promise<string> {
    return new Promise((resolve, reject) => {
        randomBytes(32, (err, buffer) => {
            if (err) {
                reject(err);
            } else {
                resolve(buffer.toString('ascii'));
            }
        });
    });
}

export function base64Encode(str: string): string {
    return Buffer.from(str, 'ascii').toString('base64');
}

export function base64Decode(str: string): string {
    return Buffer.from(str, 'base64').toString('ascii');
}

export function binaryToInt(bin: string): number {
    return algosdk.decodeUint64(Buffer.from(bin), algosdk.IntDecoding.SAFE);
}

export function intToBinary(i: number): string {
    return Buffer.from(intToBinaryArray(i)).toString('ascii');
}

export function intToBinaryArray(i: number): Uint8Array {
    return algosdk.encodeUint64(i);
}

export function base64ToAddress(b64: string): string {
    const buf = Buffer.from(b64, 'base64');
    return algosdk.encodeAddress(new Uint8Array(buf));
}

export function sha512_256(content: string): number[] {
    return sha512.sha512_256.array(content);
}
