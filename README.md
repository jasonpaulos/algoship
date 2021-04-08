Algoship :ship: :ship: :boom:
========

[![npm version](https://badge.fury.io/js/algoship.svg)](https://www.npmjs.com/package/algoship)

Algoship implements a basic version of the game [battleship](https://en.wikipedia.org/wiki/Battleship_(game))
on the Algorand blockchain.

![Algoship Terminal](https://user-images.githubusercontent.com/5856867/91487557-eba06400-e87b-11ea-902b-d5d5002cbda5.png)

To play, install Node and run:
```
npx algoship
```

The game will ask you for an node address and token to connect to an Algorand node. See [here](https://developer.algorand.org/docs/build-apps/setup/#how-do-i-obtain-an-algod-address-and-token)
for information about how to obtain those.

Backround
---------

Each player has a 3x3 grid where they place ships. Each ship occupies 1 cell in the grid.

Every piece of information needed to play the game is stored on the Algorand blockchain using a
[stateful smart contract](https://developer.algorand.org/docs/features/asc1/stateful/). This
contract is defined in `game.py`. The players interact with only this smart contract; there is no
direct communication between them.

If everything is stored on a blockchain, can players cheat?
---------

Each player's grid of ships is stored on a public blockchain, and if these grids contained plaintext
0s and 1s players would be able to easily cheat. Instead, Algoship "encrypts" the values in each
player's grids like so:

For each cell:
1. Players choose a secret string of bytes.
2. Players decide if a ship should occupy that cell.
3. They concatenate their secret with: 1 if a ship occipies this cell, otherwise 0.
4. They hash the concatenated string with SHA-512/256 and store the hash on the blockchain.

When it is time to reveal the value of a cell, the player submits that cell's secret.
The smart contract then sees if that secret followed by 0 or 1 yields the hash that player submitted
earlier, thereby revealing the hidden value.

What if a player submits a grid with 0 ships?
---------
After a game finishes, each player must disclose their secret values for any cells that remain. The
smart contract then ensures that each player placed the appropriate amount of ships.
