import { LocalState } from './core/game';
import { intToLetter } from './util';

function printGrid(values: string[][]) {
    const width = 3*values.length + 2;
    const paddingSize = Math.floor((process.stdout.columns - width)/2);
    let padding = '  ';
    let paddingMinus2 = '';
    if (paddingSize > 2) {
        const pads: string[] = [];
        for (let i = 0; i < paddingSize; i++) {
            pads.push(' ');
        }
        padding = pads.join('');
        pads.pop();
        pads.pop();
        paddingMinus2 = pads.join('');
    }

    process.stdout.write(padding + ' ');
    for (let x = 0; x < values.length; x++) {
        process.stdout.write(' ' + (x + 1) + (x < 9 ? ' ' : ''));
    }
    process.stdout.write('\n');
    
    process.stdout.write(padding + '┌');
    for (let x = 0; x < 3*values.length; x++) {
        process.stdout.write('─');
    }
    process.stdout.write('┐\n');
    
    for (let y = 0; y < values.length; y++) {
        const letter = intToLetter(y) + ' ';
        process.stdout.write(paddingMinus2 + letter + '│');
        for (let x = 0; x < values.length; x++) {
            process.stdout.write(values[y][x]);
        }
        process.stdout.write('│\n');
    }
    
    process.stdout.write(padding + '└');
    for (let x = 0; x < 3*values.length; x++) {
        process.stdout.write('─');
    }
    process.stdout.write('┘\n');
}

export function printGrids(size: number, myCells: boolean[], myState: LocalState | Set<number>, opponentState: LocalState | undefined, coordsToIndex: (x: number, y: number) => number) {
    const myValues: string[][] = [];
    for (let y = 0; y < size; y++) {
        const column: string[] = [];
        for (let x = 0; x < size; x++) {
            const index = coordsToIndex(x, y);
            let value;
            if (myState instanceof Set) {
                if ((myState as Set<number>).has(index)) {
                    value = '🚢 ';
                } else {
                    value = ' _ ';
                }
            } else {
                const cellValue = myCells[index];
                const cellState = (myState as LocalState).cells[index];
                const endgame = myState.placementValid != null;
                if (typeof(cellState) === 'number' && !endgame) {
                    if (cellValue) {
                        value = '💥 ';
                    } else {
                        value = '🌊 ';
                    }
                } else {
                    if (cellValue) {
                        value = '🚢 ';
                    } else {
                        value = ' _ ';
                    }
                }
            }
            column.push(value);
        }
        myValues.push(column);
    }

    const opponentValues: string[][] = [];
    for (let y = 0; y < size; y++) {
        const column: string[] = [];
        for (let x = 0; x < size; x++) {
            const index = coordsToIndex(x, y);
            let value;
            const cellValue = opponentState == null ? null : (opponentState as LocalState).cells[index];
            const endgame = opponentState && opponentState.placementValid != null;
            if (cellValue == null) {
                value = ' ? ';
            } else if (typeof(cellValue) === 'string') {
                value = ' ? ';
            } else if (cellValue === 0) {
                value = endgame ? ' _ ' : '🌊 ';
            } else {
                value = endgame ? '🚢 ' : '💥 ';
            }
            column.push(value);
        }
        opponentValues.push(column);
    }

    printGrid(opponentValues);
    printGrid(myValues);
}
