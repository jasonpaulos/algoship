import EventEmitter from 'eventemitter3';
import * as algosdk from 'algosdk';
import { getApprovalProgram, getClearProgram } from './teal';
import {
    trackRounds,
    waitForTransaction,
    readLocalState,
    readGlobalState,
    generateSecret,
    base64Encode,
    base64Decode,
    binaryToInt,
    intToBinary,
    intToBinaryArray,
    base64ToAddress,
} from './util';

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
    cells: (string | number | undefined)[],
}

function parseGlobalState(state: {[key: string]: string | number}): GlobalState {
    return {
        player1: base64ToAddress(state[GLOBAL_KEY_P1] as string),
        player2: base64ToAddress(state[GLOBAL_KEY_P2] as string),
        stage: state[GLOBAL_KEY_STAGE] as number || GameStage.waiting_for_p2,
        turn: state[GLOBAL_KEY_TURN] === GLOBAL_KEY_P2 ? 'player2' : 'player1',
        gridSize: state[GLOBAL_KEY_GRID_SIZE] as number,
        totalShips: state[GLOBAL_KEY_NUM_SHIPS] as number,
        currentGuess: state.hasOwnProperty(GLOBAL_KEY_GUESS) ? binaryToInt(base64Decode(state[GLOBAL_KEY_GUESS] as string)) : undefined,
        winner: state.hasOwnProperty(GLOBAL_KEY_WINNER) ? (state[GLOBAL_KEY_WINNER] === GLOBAL_KEY_P1 ? 'player1' : 'player2') : undefined,
    };
}

function parseLocalState(gridSize: number, state?: {[key: string]: string | number}): LocalState {
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

    const cells: (string | number | undefined)[] = [];
    for (let i = 0; i < gridSize * gridSize; i++) {
        const key = base64Encode(intToBinary(i));
        if (state.hasOwnProperty(key)) {
            let value = state[key];
            if (value === base64Encode(intToBinary(0))) {
                value = 0;
            } else if (value === base64Encode(intToBinary(1))) {
                value = 1;
            }
            cells.push(value);
        } else {
            cells.push(undefined);
        }
    }
    
    return {
        joined: true,
        shipsLeft: state[LOCAL_KEY_SHIPS_REMAINING] as number,
        placementValid: state[LOCAL_KEY_PLACEMENT_VALID] == null ? undefined : (state[LOCAL_KEY_PLACEMENT_VALID] === 2),
        cells,
    };
}

export class Game {

    events: EventEmitter;
    client: any;
    player: { addr: string, sk: Uint8Array };
    gameId?: number;
    opponent?: string;
    globalState?: GlobalState;
    myState?: LocalState;
    opponentState?: LocalState;
    secrets: string[];
    myCells: boolean[];

    constructor(playerMnemonic: string, client: { token: string, server: string, port: number }) {
        this.events = new EventEmitter();
        this.player = algosdk.mnemonicToSecretKey(playerMnemonic);
        this.client = new algosdk.Algodv2(client.token, client.server, client.port);
        this.secrets = [];
        this.myCells = [];
    }

    async reset() {
        const appId = this.gameId;
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
        const optOutTxn = algosdk.makeApplicationCloseOutTxn(this.player.addr, suggestedParams, appId);

        const signedOptOutTxn = optOutTxn.signTxn(this.player.sk);
        const { txId: optOutTxId } = await this.client.sendRawTransaction(signedOptOutTxn).do();

        await waitForTransaction(this.client, optOutTxId);

        if (!isCreator) {
            return;
        }

        suggestedParams = await this.client.getTransactionParams().do();
        const deleteTxn = algosdk.makeApplicationDeleteTxn(this.player.addr, suggestedParams, appId);

        const signedDeleteTxn = deleteTxn.signTxn(this.player.sk);
        const { txId: deleteTxId } = await this.client.sendRawTransaction(signedDeleteTxn).do();

        await waitForTransaction(this.client, deleteTxId);
    }

    async start(opponent: string, numShips: number): Promise<number> {
        const from = this.player.addr;
        const onComplete = algosdk.OnApplicationComplete.OptInOC;
        const suggestedParams = await this.client.getTransactionParams().do();
        const approvalProgram = await getApprovalProgram();
        const clearProgram = await getClearProgram();
        const numLocalInts = 2;
        const numLocalByteSlices = 9;
        const numGlobalInts = 5;
        const numGlobalByteSlices = 5;
        const appArgs = [algosdk.address.decode(opponent).publicKey, intToBinaryArray(numShips)];
        const txn = algosdk.makeApplicationCreateTxn(from, suggestedParams, onComplete, approvalProgram, clearProgram, numLocalInts, numLocalByteSlices, numGlobalInts, numGlobalByteSlices, appArgs);

        const signedTxn = txn.signTxn(this.player.sk);
        const { txId } = await this.client.sendRawTransaction(signedTxn).do();

        const completedTx = await waitForTransaction(this.client, txId);
        if (typeof(completedTx['application-index']) !== 'number') {
            throw new Error(`Invalid application ID, got ${completedTx['application-index']}`);
        }
        this.gameId = completedTx['application-index'];
        this.opponent = opponent;

        this.globalState = parseGlobalState(await readGlobalState(this.client, this.gameId));

        this._begin();
        return this.gameId;
    }

    async join(appId: number) {
        this.gameId = appId;

        const suggestedParams = await this.client.getTransactionParams().do();
        const txn = algosdk.makeApplicationOptInTxn(this.player.addr, suggestedParams, appId);

        const signedTxn = txn.signTxn(this.player.sk);
        const { txId } = await this.client.sendRawTransaction(signedTxn).do();

        await waitForTransaction(this.client, txId);

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
                        this.secrets.push('');
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
                            if (typeof(myState.cells[i]) === 'string') {
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

    async placeAllCells(ships: Set<number>, progress?: (cellsPlaced: number) => any) {
        if (this.globalState!.stage > GameStage.placement) {
            throw new Error('Not in placement stage');
        }

        if (ships.size !== this.globalState!.totalShips) {
            throw new Error('Incorrect number of ships');
        }

        const suggestedParams = await this.client.getTransactionParams().do();

        const cells = this.globalState!.gridSize * this.globalState!.gridSize;
        for (let i = 0; i < cells; i++) {
            await this.placeNextCell(ships.has(i), suggestedParams);
            if (progress) {
                progress(i + 1);
            }
        }
    }

    async placeNextCell(hasShip: boolean, suggestedParams: any = null) {
        const secret = await generateSecret();
        for (let i = 0; i < this.secrets.length; i++) {
            if (this.secrets[i].length === 0) {
                this.secrets[i] = secret;
                this.myCells[i] = hasShip;
                break;
            }
        }
        const secretAndValue = secret + (hasShip ? '\x01' : '\x00');
        const hashedArray = algosdk.nacl.genericHash(secretAndValue);

        if (suggestedParams == null) {
            suggestedParams = await this.client.getTransactionParams().do();
        }

        const appArgs = [Uint8Array.from(hashedArray)];
        const txn = algosdk.makeApplicationNoOpTxn(this.player.addr, suggestedParams, this.gameId!, appArgs);

        const signedTxn = txn.signTxn(this.player.sk);
        const { txId } = await this.client.sendRawTransaction(signedTxn).do();

        await waitForTransaction(this.client, txId);
    }

    async guessCell(x: number, y: number) {
        if (this.globalState!.stage != GameStage.guess) {
            throw new Error('Not in guess stage');
        }

        const index = this.coordsToIndex(x, y);
        const appArgs = [intToBinaryArray(index)];

        const suggestedParams = await this.client.getTransactionParams().do();
        const txn = algosdk.makeApplicationNoOpTxn(this.player.addr, suggestedParams, this.gameId!, appArgs);

        const signedTxn = txn.signTxn(this.player.sk);
        const { txId } = await this.client.sendRawTransaction(signedTxn).do();

        await waitForTransaction(this.client, txId);
    }

    async revealCell(index: number, includeIndex: boolean) {
        const secret = index < this.secrets.length ? this.secrets[index] : '';
        const appArgs = [Uint8Array.from(secret, c => c.charCodeAt(0))];

        if (includeIndex) {
            appArgs.push(intToBinaryArray(index));
        }

        const suggestedParams = await this.client.getTransactionParams().do();
        const txn = algosdk.makeApplicationNoOpTxn(this.player.addr, suggestedParams, this.gameId!, appArgs);

        const signedTxn = txn.signTxn(this.player.sk);
        const { txId } = await this.client.sendRawTransaction(signedTxn).do();

        await waitForTransaction(this.client, txId);
    }

    onGuessNeeded(listener: () => any) {
        this.events.on('guessNeeded', listener);
    }
    
    onGuessResult(listener: (index: number, hit: boolean, gameOver: boolean) => any) {
        this.events.on('guessResult', listener);
    }

    onOpponentGuess(listener: (index: number, hit: boolean, gameOver: boolean) => any) {
        this.events.on('opponentGuess', listener);
    }

    onFinish(listener: (didIWin: boolean, myGridValid: boolean, opponentGridValid: boolean) => any) {
        this.events.on('finish', listener);
    }

    static isValidAddress(addr: string): boolean {
        return algosdk.isValidAddress(addr);
    }
}
