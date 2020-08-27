#! /usr/bin/env node
import { Game } from './core/game';
import prompts from 'prompts';
import cliProgress from 'cli-progress';
import { printGrids } from './print';
import { cellToCoords, coordsToCell } from './util';

async function start() {
    try {
        const {
            promptServer,
            promptPort,
            promptToken,
            promptMnemonic,
        } = await prompts([
            {
                type: process.env.ALGO_SERVER ? false : 'text',
                name: 'promptServer',
                message: 'Algorand node address'
            },
            {
                type: process.env.ALGO_PORT ? false : 'number',
                name: 'promptPort',
                message: 'Node port'
            },
            {
                type: process.env.ALGO_TOKEN ? false : 'invisible',
                name: 'promptToken',
                message: 'Node token'
            },
            {
                type: process.env.ALGO_MNEMONIC ? false : 'invisible',
                name: 'promptMnemonic',
                message: 'Account mnemonic'
            }
        ]);

        const mnemonic = process.env.ALGO_MNEMONIC || promptMnemonic;
        const token = process.env.ALGO_TOKEN || promptToken;
        const server = process.env.ALGO_SERVER || promptServer;
        const port = process.env.ALGO_PORT ? parseInt(process.env.ALGO_PORT, 10) : promptPort;

        const game = new Game(mnemonic, { token, server, port });

        while (true) {
            await playGame(game);

            console.log('Cleaning up...');
            await game.reset();

            const { choice } = await prompts({
                type: 'confirm',
                name: 'choice',
                message: 'Would you like to play again?',
            });

            if (!choice) {
                break;
            }
        }

    } catch (err) {
        console.error(err);
    }
}

async function playGame(game: Game) {
    const { startType } = await prompts({
        type: 'select',
        name: 'startType',
        message: `Hi ${game.player.addr}, welcome to Algoship.`,
        choices: [
            { title: 'Start a game', value: 'start' },
            { title: 'Join a game', value: 'join' }
        ]
    })
    
    if (startType === 'start') {
        const { opponent, numShips } = await prompts([
            {
                type: 'text',
                name: 'opponent',
                message: 'Address of opponent',
                validate: addr => Game.isValidAddress(addr) ? true : 'Invalid Address'
            },
            {
                type: 'number',
                name: 'numShips',
                message: 'Number of ships',
                validate: num => num > 0 && num <= 9 ? true : 'Number must be in the range (0, 9]'
            }
        ]);
        console.log('Starting game...');
        const id = await game.start(opponent, numShips);
        console.log(`Started game with app ID ${id}. Give this number to your opponent.`)
    } else {
        const { appId } = await prompts({
            type: 'number',
            name: 'appId',
            message: 'App ID of game',
            validate: id => id > 0 ? true : 'ID must be positive'
        });
        console.log('Joining game...');
        await game.join(appId);
        console.log(`Joined game ${appId} against opponent ${game.opponent!}`);
    }

    game.onGuessNeeded(() => {
        guess(game);
    });

    game.onGuessResult((index, hit, gameOver) => {
        console.log(`Opponent revealed that you hit ${hit ? 'a ship!' : 'nothing.'}`);

        if (!hit || gameOver) {
            printGrids(game.globalState!.gridSize, game.myCells, game.myState!, game.opponentState!, game!.coordsToIndex.bind(game));
        }

        if (gameOver) {
            onGameOver(game, true);
        } else if (!hit) {
            console.log('Waiting for opponent to guess...');
        }
    });

    game.onOpponentGuess((index, hit, gameOver) => {
        const [x, y] = game.indexToCoords(index);
        console.log(`Opponent guessed ${coordsToCell(x, y)}. They hit ${hit ? 'a ship!' : 'nothing.'}`);

        const myStateWithReveal = { ...game.myState! };
        myStateWithReveal.cells = [...game.myState!.cells];
        myStateWithReveal.cells[index] = game.myCells[index] ? 1 : 0;

        if (hit) {
            printGrids(game.globalState!.gridSize, game.myCells, myStateWithReveal, game.opponentState!, game!.coordsToIndex.bind(game));
        }

        if (gameOver) {
            onGameOver(game, false);
        }
    });

    const gameOver = new Promise((resolve, reject) => {
        game.onFinish((win, myGridValid, opponentGridValid) => {
            const gridSize = game.globalState!.gridSize;
            printGrids(gridSize, game.myCells, game.myState!, game.opponentState!, game!.coordsToIndex.bind(game));
    
            const result = win ? 'win' : 'lose';
    
            if (myGridValid) {
                if (opponentGridValid) {
                    console.log(`Both grids are valid. You ${result}!`);
                } else {
                    console.log(`Your opponent's grid is invalid. You win!`);
                }
            } else {
                if (opponentGridValid) {
                    console.log(`Your grid is invalid. You lose!`);
                } else {
                    console.log(`Both your grid and your opponent's grid is invalid. I guess it's a draw?`);
                }
            }

            resolve();
        });
    });

    await placeShips(game);

    console.log('Waiting for opponent...');

    await gameOver;
}

async function placeShips(game: Game) {
    const gridSize = game.globalState!.gridSize;
    const totalShips = game.globalState!.totalShips;
    const ships: Set<number> = new Set();
    const isValidPlacement = cell => {
        try {
            if (cell.length !== 2) {
                return 'Only enter two characters.';
            }
            const [x, y] = cellToCoords(cell);
            if (x < 0 || x >= gridSize || y < 0 || y >= gridSize) {
                return 'Invalid cell.';
            }
            const index = game.coordsToIndex(x, y);
            if (ships.has(index)) {
                return 'There is already a ship in that cell.'
            }
            return true;
        } catch (err) {
            return false;
        }
    };

    for (let i = 0; i < totalShips; i++) {
        printGrids(gridSize, game.myCells, ships, game.opponentState!, game!.coordsToIndex.bind(game));

        const { cell } = await prompts({
            type: 'text',
            name: 'cell',
            message: `Where would you like to put ship ${i+1} of ${totalShips}?`,
            validate: isValidPlacement
        });
        const [x, y] = cellToCoords(cell);
        const index = game.coordsToIndex(x, y);
        ships.add(index);
    }

    printGrids(gridSize, game.myCells, ships, game.opponentState!, game!.coordsToIndex.bind(game));

    console.log('Placing ships...');

    const bar = new cliProgress.SingleBar({}, cliProgress.Presets.shades_classic);
    bar.start(gridSize * gridSize, 0);

    await game.placeAllCells(ships, cellsPlaced => bar.update(cellsPlaced));

    bar.stop();

    console.log('Done.');
}

async function guess(game: Game) {
    try {
        const gridSize = game.globalState!.gridSize;
        const shipsLeft = game.opponentState!.shipsLeft;
        const isValidGuess = cell => {
            try {
                if (cell.length !== 2) {
                    return 'Only enter two characters.';
                }
                const [x, y] = cellToCoords(cell);
                if (x < 0 || x >= gridSize || y < 0 || y >= gridSize) {
                    return 'Invalid cell.';
                }
                const index = game.coordsToIndex(x, y);
                if (typeof(game.opponentState!.cells[index]) !== 'string') {
                    return 'You have already guessed that cell.'
                }
                return true;
            } catch (err) {
                return false;
            }
        };

        console.log(`Your opponent has ${shipsLeft} ship${shipsLeft === 1 ? '' : 's'} left:`);
        printGrids(gridSize, game.myCells, game.myState!, game.opponentState!, game!.coordsToIndex.bind(game));

        const { cell } = await prompts({
            type: 'text',
            name: 'cell',
            message: 'Which of your opponent\'s cells would you like to guess?',
            validate: isValidGuess
        });
        const [x, y] = cellToCoords(cell);
        
        console.log('Sending guess...');
        await game.guessCell(x, y);
        console.log('Waiting for opponent to reveal cell...');
    } catch (err) {
        console.error(err);
    }
}

function onGameOver(game: Game, didWeWin: boolean) {
    console.log('The game is over. Revealing all cells to opponent...');
}

start();
