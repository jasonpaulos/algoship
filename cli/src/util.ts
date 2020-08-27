
export function intToLetter(i: number): string {
    return String.fromCharCode('A'.charCodeAt(0) + i);
}

export function letterToInt(l: string): number {
    return l.charCodeAt(0) - 'A'.charCodeAt(0);
}

export function cellToCoords(cell: string): [number, number] {
    const y = letterToInt(cell.substr(0, 1));
    const x = parseInt(cell.substr(1, 1), 10) - 1;
    return [x, y];
}

export function coordsToCell(x: number, y: number): string {
    return intToLetter(y) + (x + 1);
}
