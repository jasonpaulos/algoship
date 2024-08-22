import EventEmitter from 'eventemitter3';
import algosdk from 'algosdk';
import { getApprovalProgram, getClearProgram } from './teal.js';
import {
    trackRounds,
    waitForTransaction,
    readLocalState,
    readGlobalState,
    generateSecret,
    base64Encode,
    binaryToInt,
    intToBinaryArray,
    sha512_256,
    arraysEqual,
} from './util.js';

export const GameStage = {
    waiting_for_p2: 0,
    placement: 1,
    guess: 2,
    reveal: 3,
    post_reveal: 4,
    finished: 5,
};

const GLOBAL_KEY_P1 = base64Encode('p1');
const GLOBAL_KEY_P2 = base64Encode('p2');
const GLOBAL_KEY_NUM_PLACED = base64Encode('num placed');
const GLOBAL_KEY_STAGE = base64Encode('stage');
const GLOBAL_KEY_TURN = base64Encode('turn');
const GLOBAL_KEY_GUESS = base64Encode('guess');
const GLOBAL_KEY_WINNER = base64Encode('winner');
const GLOBAL_KEY_NUM_REVEALED = base64Encode('num revealed');
const GLOBAL_KEY_GRID_SIZE = base64Encode('grid size');
const GLOBAL_KEY_NUM_SHIPS = base64Encode('num ships');

const LOCAL_KEY_PLACING = base64Encode('placing');
const LOCAL_KEY_SHIPS_REMAINING = base64Encode('ships');
const LOCAL_KEY_PLACEMENT_VALID = base64Encode('placement');

export interface GlobalState {
    player1: string,
    player2: string,
    stage: number,
    turn: 'player1' | 'player2',
    gridSize: number,
    totalShips: number,
    currentGuess?: number,
    winner?: 'player1' | 'player2',
}

export interface LocalState {
    joined: boolean,
    shipsLeft: number,
    placementValid?: boolean;
    cells: (Uint8Array | number | undefined)[],
}

function parseGlobalState(state: {[key: string]: bigint | Uint8Array}): GlobalState {
    return {
        player1: new algosdk.Address(state[GLOBAL_KEY_P1] as Uint8Array).toString(),
        player2: new algosdk.Address(state[GLOBAL_KEY_P2] as Uint8Array).toString(),
        stage: Number(state[GLOBAL_KEY_STAGE]) || GameStage.waiting_for_p2,
        turn: state.hasOwnProperty(GLOBAL_KEY_TURN) && algosdk.bytesToBase64(state[GLOBAL_KEY_TURN] as Uint8Array) === GLOBAL_KEY_P2 ? 'player2' : 'player1',
        gridSize: Number(state[GLOBAL_KEY_GRID_SIZE]),
        totalShips: Number(state[GLOBAL_KEY_NUM_SHIPS]),
        currentGuess: state.hasOwnProperty(GLOBAL_KEY_GUESS) ? binaryToInt(state[GLOBAL_KEY_GUESS] as Uint8Array) : undefined,
        winner: state.hasOwnProperty(GLOBAL_KEY_WINNER) ? (algosdk.bytesToBase64(state[GLOBAL_KEY_WINNER] as Uint8Array) === GLOBAL_KEY_P1 ? 'player1' : 'player2') : undefined,
    };
}

function parseLocalState(gridSize: number, state?: {[key: string]: bigint | Uint8Array}): LocalState {
    if (state == null) {
        const cells: undefined[] = [];
        for (let i = 0; i < gridSize * gridSize; i++) {
            cells.push(undefined);
        }
        return {
            joined: false,
            shipsLeft: 0,
            cells,
        }
    }

    const cells: (Uint8Array | number | undefined)[] = [];
    for (let i = 0; i < gridSize * gridSize; i++) {
        const key = algosdk.bytesToBase64(intToBinaryArray(i));
        if (state.hasOwnProperty(key)) {
            const value = state[key];
            if (value instanceof Uint8Array) {
                if (arraysEqual(value, intToBinaryArray(0))) {
                    cells.push(0);
                } else if (arraysEqual(value, intToBinaryArray(1))) {
                    cells.push(1);
                } else {
                    cells.push(value);
                }
            } else {
                throw new Error(`Unexpected value type for key ${key}: ${value}`);
            }
        } else {
            cells.push(undefined);
        }
    }
    
    return {
        joined: true,
        shipsLeft: Number(state[LOCAL_KEY_SHIPS_REMAINING]),
        placementValid: state[LOCAL_KEY_PLACEMENT_VALID] == null ? undefined : (state[LOCAL_KEY_PLACEMENT_VALID] === BigInt(2)),
        cells,
    };
}

export class Game {

    events: EventEmitter;
    client: algosdk.Algodv2;
    player: { addr: string, sk: Uint8Array };
    gameId?: bigint;
    opponent?: string;
    globalState?: GlobalState;
    myState?: LocalState;
    opponentState?: LocalState;
    secrets: Uint8Array[];
    myCells: boolean[];

    constructor(playerMnemonic: string, client: { token: string, server: string, port: number }) {
        this.events = new EventEmitter();
        const player = algosdk.mnemonicToSecretKey(playerMnemonic);
        this.player = {
            addr: player.addr.toString(),
            sk: player.sk,
        };
        this.client = new algosdk.Algodv2(client.token, client.server, client.port);
        this.secrets = [];
        this.myCells = [];
    }

    async reset() {
        const appId = this.gameId!;
        const isCreator = this.globalState!.player1 === this.player.addr;

        this.events.removeAllListeners();
        this.gameId = undefined;
        this.opponent = undefined;
        this.globalState = undefined;
        this.myState = undefined;
        this.opponentState = undefined;
        this.secrets = [];
        this.myCells = [];

        let suggestedParams = await this.client.getTransactionParams().do();
        const optOutTxn = algosdk.makeApplicationCloseOutTxnFromObject({
            sender: this.player.addr,
            suggestedParams,
            appIndex: appId
        });

        const signedOptOutTxn = optOutTxn.signTxn(this.player.sk);
        const { txid: optOutTxId } = await this.client.sendRawTransaction(signedOptOutTxn).do();

        await waitForTransaction(this.client, optOutTxId);

        if (!isCreator) {
            return;
        }

        suggestedParams = await this.client.getTransactionParams().do();
        const deleteTxn = algosdk.makeApplicationDeleteTxnFromObject({
            sender: this.player.addr,
            suggestedParams,
            appIndex: appId
        });

        const signedDeleteTxn = deleteTxn.signTxn(this.player.sk);
        const { txid: deleteTxId } = await this.client.sendRawTransaction(signedDeleteTxn).do();

        await waitForTransaction(this.client, deleteTxId);
    }

    async start(opponent: string, numShips: number): Promise<bigint> {
        const sender = this.player.addr;
        const onComplete = algosdk.OnApplicationComplete.OptInOC;
        const suggestedParams = await this.client.getTransactionParams().do();
        const approvalProgram = await getApprovalProgram();
        const clearProgram = await getClearProgram();
        const numLocalInts = 2;
        const numLocalByteSlices = 9;
        const numGlobalInts = 5;
        const numGlobalByteSlices = 5;
        const appArgs = [algosdk.decodeAddress(opponent).publicKey, intToBinaryArray(numShips)];
        const txn = algosdk.makeApplicationCreateTxnFromObject({
            sender,
            suggestedParams,
            onComplete,
            approvalProgram,
            clearProgram,
            numLocalInts,
            numLocalByteSlices,
            numGlobalInts,
            numGlobalByteSlices,
            appArgs
        });

        const signedTxn = txn.signTxn(this.player.sk);
        const { txid } = await this.client.sendRawTransaction(signedTxn).do();

        const completedTx = await waitForTransaction(this.client, txid);
        const appId = completedTx.applicationIndex;
        if (!appId) {
            throw new Error(`Invalid application ID, got ${appId}`);
        }
        this.gameId = appId;
        this.opponent = opponent;

        this.globalState = parseGlobalState(await readGlobalState(this.client, this.gameId));

        this._begin();
        return this.gameId;
    }

    async join(appId: bigint) {
        this.gameId = appId;

        const suggestedParams = await this.client.getTransactionParams().do();
        const txn = algosdk.makeApplicationOptInTxnFromObject({
            sender: this.player.addr,
            suggestedParams,
            appIndex: appId
        });

        const signedTxn = txn.signTxn(this.player.sk);
        const { txid } = await this.client.sendRawTransaction(signedTxn).do();

        await waitForTransaction(this.client, txid);

        this.globalState = parseGlobalState(await readGlobalState(this.client, this.gameId));
        this.opponent = this.globalState.player1;

        if (typeof(this.opponent) !== 'string') {
            throw new Error('Could not read opponent from global state');
        }

        this._begin();
    }

    async _begin() {
        try {
            for await (const round of trackRounds(this.client)) {
                if (this.gameId == null) {
                    break;
                }

                const [
                    globalStateRaw,
                    myStateRaw,
                    opponentStateRaw,
                ] = await Promise.all([
                    readGlobalState(this.client, this.gameId!),
                    readLocalState(this.client, this.gameId!, this.player.addr),
                    readLocalState(this.client, this.gameId!, this.opponent!),
                ]);

                const globalState = parseGlobalState(globalStateRaw);
                const myState = parseLocalState(globalState.gridSize, myStateRaw);
                const opponentState = parseLocalState(globalState.gridSize, opponentStateRaw);

                if (this.secrets.length === 0) {
                    for (let i = 0; i < globalState.gridSize * globalState.gridSize; i++) {
                        this.secrets.push(new Uint8Array());
                        this.myCells.push(false);
                    }
                }

                const stageChange = this.globalState!.stage !== globalState!.stage;
                const oldState = this.globalState!;

                this.globalState = globalState;
                this.myState = myState;
                this.opponentState = opponentState;

                if (stageChange) {
                    if (oldState.stage === GameStage.reveal && globalState![oldState.turn] === this.player.addr) {
                        const index = oldState.currentGuess!;
                        const cellValue = opponentState.cells[index];
                        setTimeout(() => {
                            this.events.emit('guessResult', index, cellValue, globalState.stage === GameStage.post_reveal);
                        }, 0);
                    }

                    switch (globalState!.stage) {
                    case GameStage.guess:
                        if (globalState![globalState!.turn] === this.player.addr) {
                            setTimeout(() => {
                                this.events.emit('guessNeeded');
                            }, 0);
                        }
                        break;
                    case GameStage.reveal:
                        if (globalState[globalState.turn] === this.opponent) {
                            const index = globalState.currentGuess!
                            if (index > globalState.gridSize! * globalState.gridSize!) {
                                throw new Error(`Opponent's guess is outside grid size, got ${index}.`)
                            }
                            this.revealCell(index, false).catch(err => {
                                console.error(`Error when revealing cell ${index}`);
                                console.error(err);
                            });
                            const hit = this.myCells[index];
                            const gameOver = hit && myState.shipsLeft === 1;
                            setTimeout(() => {
                                this.events.emit('opponentGuess', index, hit, gameOver);
                            }, 0);
                        }
                        break;
                    case GameStage.post_reveal:
                        const revealRemaining: Promise<void>[] = [];
                        for (let i = 0; i < myState.cells.length; i++) {
                            if (myState.cells[i] instanceof Uint8Array) {
                                revealRemaining.push(this.revealCell(i, true));
                            }
                        }
                        Promise.all(revealRemaining)
                            .then(() => this.revealCell(myState.cells.length, true))
                            .catch(err => {
                                console.error(`Error in post reveal`);
                                console.error(err);
                            });
                        break;
                    case GameStage.finished:
                        const didIWin = globalState[globalState.winner!] === this.player.addr;
                        const myGridValid = myState.placementValid!;
                        const opponentGridValid = opponentState.placementValid!;
                        setTimeout(() => {
                            this.events.emit('finish', didIWin, myGridValid, opponentGridValid);
                        }, 0);
                        break;
                    }
                }
            }
        } catch (err) {
            console.error('Error in internal game loop');
            console.error(err);
        }
    }

    coordsToIndex(x: number, y: number): number {
        return x + y * this.globalState!.gridSize;
    }

    indexToCoords(index: number): [number, number] {
        const gridSize = this.globalState!.gridSize;
        const x = index % gridSize;
        const y = Math.floor(index / gridSize);
        return [x, y];
    }

    async placeAllCells(ships: Set<number>) {
        if (this.globalState!.stage > GameStage.placement) {
            throw new Error('Not in placement stage');
        }

        if (ships.size !== this.globalState!.totalShips) {
            throw new Error('Incorrect number of ships');
        }

        const suggestedParams = await this.client.getTransactionParams().do();
        let txns: algosdk.Transaction[] = [];

        const cells = this.globalState!.gridSize * this.globalState!.gridSize;
        for (let i = 0; i < cells; i++) {
            const txn = await this.placeNextCell(ships.has(i), suggestedParams);
            txns.push(txn);
        }

        while (txns.length > 0) {
            const endIndex = Math.min(txns.length, 16);
            const txnGroup = algosdk.assignGroupID(txns.slice(0, endIndex));
            txns = txns.slice(endIndex);

            const signedTxns = txnGroup.map(txn => txn.signTxn(this.player.sk));

            const { txid } = await this.client.sendRawTransaction(signedTxns).do();
            await waitForTransaction(this.client, txid);
        }
    }

    async placeNextCell(hasShip: boolean, suggestedParams?: algosdk.SuggestedParams): Promise<algosdk.Transaction> {
        const secret = await generateSecret();
        for (let i = 0; i < this.secrets.length; i++) {
            if (this.secrets[i].length === 0) {
                this.secrets[i] = secret;
                this.myCells[i] = hasShip;
                break;
            }
        }
        const secretAndValue = new Uint8Array(secret.length + 1);
        secretAndValue.set(secret);
        secretAndValue[secret.length] = hasShip ? 1 : 0;
        const hashedArray = sha512_256(secretAndValue);

        if (suggestedParams == null) {
            suggestedParams = await this.client.getTransactionParams().do();
        }

        const txn = algosdk.makeApplicationNoOpTxnFromObject({
            sender: this.player.addr,
            suggestedParams,
            appIndex: this.gameId!,
            appArgs: [hashedArray]
        });

        return txn;
    }

    async guessCell(x: number, y: number) {
        if (this.globalState!.stage != GameStage.guess) {
            throw new Error('Not in guess stage');
        }

        const index = this.coordsToIndex(x, y);
        const appArgs = [intToBinaryArray(index)];

        const suggestedParams = await this.client.getTransactionParams().do();
        const txn = algosdk.makeApplicationNoOpTxnFromObject({
            sender: this.player.addr,
            suggestedParams,
            appIndex: this.gameId!,
            appArgs
        });

        const signedTxn = txn.signTxn(this.player.sk);
        const { txid } = await this.client.sendRawTransaction(signedTxn).do();

        await waitForTransaction(this.client, txid);
    }

    async revealCell(index: number, includeIndex: boolean) {
        const secret = index < this.secrets.length ? this.secrets[index] : new Uint8Array();
        const appArgs = [secret];

        if (includeIndex) {
            appArgs.push(intToBinaryArray(index));
        }

        const suggestedParams = await this.client.getTransactionParams().do();
        const txn = algosdk.makeApplicationNoOpTxnFromObject({
           sender: this.player.addr,
           suggestedParams,
           appIndex: this.gameId!,
           appArgs
        });

        const signedTxn = txn.signTxn(this.player.sk);
        const { txid } = await this.client.sendRawTransaction(signedTxn).do();

        await waitForTransaction(this.client, txid);
    }

    onGuessNeeded(listener: () => unknown) {
        this.events.on('guessNeeded', listener);
    }
    
    onGuessResult(listener: (index: number, hit: boolean, gameOver: boolean) => unknown) {
        this.events.on('guessResult', listener);
    }

    onOpponentGuess(listener: (index: number, hit: boolean, gameOver: boolean) => unknown) {
        this.events.on('opponentGuess', listener);
    }

    onFinish(listener: (didIWin: boolean, myGridValid: boolean, opponentGridValid: boolean) => unknown) {
        this.events.on('finish', listener);
    }

    static isValidAddress(addr: string): boolean {
        return algosdk.isValidAddress(addr);
    }
}
