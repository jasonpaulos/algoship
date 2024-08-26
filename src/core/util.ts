import { randomBytes } from 'crypto';
import algosdk from 'algosdk';
import sha512 from 'js-sha512';

export async function* trackRounds(client: algosdk.Algodv2) {
    let lastStatus = await client.status().do();
    let lastRound = lastStatus.lastRound;
    while (true) {
        yield lastRound;
        lastRound++
        await client.statusAfterBlock(lastRound).do();
    }
}

export function waitForTransaction(client: algosdk.Algodv2, txId: string): Promise<algosdk.modelsv2.PendingTransactionResponse> {
    return algosdk.waitForConfirmation(client, txId, 10);
}

export function decodeState(stateArray: algosdk.modelsv2.TealKeyValue[] | undefined) {
    const state: {[key: string]: bigint | Uint8Array} = {};
    if (!stateArray) {
        return state;
    }

    for (const pair of stateArray) {
        const key = pair.key;
        let value: bigint | Uint8Array;

        if (pair.value.type === 2) {
            // value is uint64
            value = pair.value.uint;
        } else {
            // value is byte array
            value = pair.value.bytes;
        }

        state[algosdk.bytesToBase64(key)] = value;
    }

    return state;
}

export async function readLocalState(client: algosdk.Algodv2, appId: bigint, account: string): Promise<{[key: string]: bigint | Uint8Array} | undefined> {
    let appLocalInfo: algosdk.modelsv2.AccountApplicationResponse;
    try {
        appLocalInfo = await client.accountApplicationInformation(account, appId).do();
    } catch (err) {
        if (err instanceof Error && (err as unknown as algosdk.BaseHTTPClientError).response.status === 404) {
            // Account is not opted in to the app
            return undefined;
        } else {
            throw err;
        }
    }
    return decodeState(appLocalInfo.appLocalState?.keyValue);
}

export async function readGlobalState(client: algosdk.Algodv2, appId: bigint): Promise<{[key: string]: bigint | Uint8Array}> {
    const app = await client.getApplicationByID(appId).do();
    return decodeState(app.params.globalState);
}

export async function generateSecret(): Promise<Uint8Array> {
    return new Promise((resolve, reject) => {
        randomBytes(32, (err, buffer) => {
            if (err) {
                reject(err);
            } else {
                resolve(new Uint8Array(buffer));
            }
        });
    });
}

export function base64Encode(str: string): string {
    return Buffer.from(str, 'ascii').toString('base64');
}

export function binaryToInt(bin: Uint8Array): number {
    return algosdk.decodeUint64(bin, algosdk.IntDecoding.SAFE);
}

export function intToBinaryArray(i: number): Uint8Array {
    return algosdk.encodeUint64(i);
}

export function sha512_256(content: Uint8Array): Uint8Array {
    return Uint8Array.from(sha512.sha512_256.array(content));
}

export function arraysEqual<T>(a: ArrayLike<T>, b: ArrayLike<T>): boolean {
    if (a.length !== b.length) {
        return false;
    }

    for (let i = 0; i < a.length; i++) {
        if (a[i] !== b[i]) {
            return false;
        }
    }

    return true;
}
