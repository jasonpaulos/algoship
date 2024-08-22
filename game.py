from pyteal import *

class Stage:
    waiting_for_p2 = Int(0)
    placement = Int(1)
    guess = Int(2)
    reveal = Int(3)
    post_reveal = Int(4)
    finished = Int(5)

# constants
grid_size_static = 3
grid_size = Int(grid_size_static)
max_ships = grid_size*grid_size
Hash = Sha512_256

# global state keys
player_1 = Bytes("p1")
player_2 = Bytes("p2")
num_ships = Bytes("num ships")
num_placed = Bytes("num placed")
stage = Bytes("stage")
turn = Bytes("turn")
winner = Bytes("winner")
num_revealed = Bytes("num revealed")

# local state keys
need_to_place = Bytes("placing")
ships_remaining = Bytes("ships")
placement = Bytes("placement")

def approval_program():
    on_creation = Seq([
        Assert(Btoi(Txn.application_args[1]) <= max_ships),
        App.globalPut(player_1, Txn.sender()),
        App.globalPut(player_2, Txn.application_args[0]),
        App.globalPut(Bytes("grid size"), grid_size),
        App.globalPut(num_ships, Btoi(Txn.application_args[1])),
        App.localPut(Int(0), need_to_place, Int(1)),
        Return(Int(1))
    ])

    on_delete = Return(And(
        Not(App.optedIn(Int(0), App.id())),
        Or(
            Txn.sender() == App.globalGet(player_1),
            Txn.sender() == App.globalGet(player_2)
        )
    ))

    on_update = Return(Int(0))

    on_closeout = Return(App.globalGet(stage) == Stage.finished)

    on_register = Seq([
        If(App.globalGet(stage) != Stage.waiting_for_p2,
            Return(Int(0))
        ),
        App.globalPut(stage, Stage.placement),
        App.localPut(Int(0), need_to_place, Int(1)),
        Return(Txn.sender() == App.globalGet(player_2))
    ])

    current_index = Bytes("curIndex")
    get_current_index = App.localGet(Int(0), current_index)
    placement_stage = Seq([
        Assert(App.localGet(Int(0), need_to_place)),
        App.localPut(Int(0), Itob(get_current_index), Txn.application_args[0]),
        App.localPut(Int(0), current_index, get_current_index + Int(1)),
        If(get_current_index == grid_size * grid_size, # all cells have been filled
            Seq([
                App.localDel(Int(0), need_to_place),
                App.localDel(Int(0), current_index),
                App.localPut(Int(0), ships_remaining, App.globalGet(num_ships)),
                If(App.globalGet(num_placed) == Int(0),
                    App.globalPut(num_placed, Int(1)),
                    Seq([ # enter guess stage
                        App.globalDel(num_placed),
                        App.globalPut(stage, Stage.guess),
                        App.globalPut(turn, player_1)
                    ])
                )
            ])
        ),
        Return(Int(1))
    ])

    player_guess = Bytes("guess")
    guess_index = Txn.application_args[0] # as bytes
    guess_stage = Seq([
        App.globalPut(player_guess, guess_index),
        App.globalPut(stage, Stage.reveal),
        Return(And(
            Txn.sender() == App.globalGet(App.globalGet(turn)),
            Btoi(guess_index) < grid_size * grid_size
        ))
    ])

    revealer = If(App.globalGet(turn) == player_1,
        player_2,
        player_1
    )

    reveal_miss = Seq([
        Assert(Txn.sender() == App.globalGet(revealer)),
        App.localPut(Int(0), App.globalGet(player_guess), Itob(Int(0))),
        App.globalPut(stage, Stage.guess),
        App.globalPut(turn, revealer),
        Return(Int(1))
    ])

    reveal_hit = Seq([
        App.localPut(Int(0), App.globalGet(player_guess), Itob(Int(1))),
        App.localPut(Int(0), ships_remaining, App.localGet(Int(0), ships_remaining) - Int(1)),
        If(App.localGet(Int(0), ships_remaining) == Int(0),
            Seq([
                App.globalPut(stage, Stage.post_reveal),
                App.globalPut(winner, App.globalGet(turn))
            ]),
            App.globalPut(stage, Stage.guess)
        ),
        Return(Txn.sender() != App.globalGet(App.globalGet(turn)))
    ])

    player_secret = Txn.application_args[0]
    secret_and_0 = Concat(player_secret, Bytes("\x00"))
    secret_and_1 = Concat(player_secret, Bytes("\x01"))
    encrypted_cell = App.localGet(Int(0), App.globalGet(player_guess))
    reveal_stage = Cond(
        [encrypted_cell == Hash(secret_and_0), reveal_miss],
        [encrypted_cell == Hash(secret_and_1), reveal_hit]
    )

    found_ships = Btoi(App.localGet(Int(0), Itob(Int(0))))
    for i in range(1, grid_size_static*grid_size_static):
        found_ships = found_ships + Btoi(App.localGet(Int(0), Itob(Int(i))))
    validate_cells = found_ships == App.globalGet(num_ships)

    revealed_index = Txn.application_args[1] # as bytes
    encrypted_cell_from_revealed_index = App.localGet(Int(0), revealed_index)
    revealed_cell = Cond(
        [encrypted_cell_from_revealed_index == Hash(secret_and_0), Itob(Int(0))],
        [encrypted_cell_from_revealed_index == Hash(secret_and_1), Itob(Int(1))]
    )
    post_reveal_stage = Seq([
        Assert(App.localGet(Int(0), placement) == Int(0)),
        If(Btoi(revealed_index) < grid_size * grid_size,
            App.localPut(Int(0), revealed_index, revealed_cell),
            Seq([
                App.localPut(Int(0), placement, validate_cells + Int(1)),
                If(App.globalGet(num_revealed) == Int(0),
                    App.globalPut(num_revealed, Int(1)),
                    App.globalPut(stage, Stage.finished)
                )
            ])
        ),
        Return(Int(1))
    ])

    program = Cond(
        [Txn.application_id() == Int(0), on_creation],
        [Txn.on_completion() == OnComplete.DeleteApplication, on_delete],
        [Txn.on_completion() == OnComplete.UpdateApplication, on_update],
        [Txn.on_completion() == OnComplete.CloseOut, on_closeout],
        [Txn.on_completion() == OnComplete.OptIn, on_register],
        [App.globalGet(stage) <= Stage.placement, placement_stage],
        [App.globalGet(stage) == Stage.guess, guess_stage],
        [App.globalGet(stage) == Stage.reveal, reveal_stage],
        [App.globalGet(stage) == Stage.post_reveal, post_reveal_stage]
    )

    return program

def close_out_program():
    program = If(App.globalGet(stage) == Stage.finished,
        Return(Int(1)),
        Seq([
            App.globalPut(stage, Stage.finished),
            App.globalPut(winner, If(Txn.sender() == App.globalGet(player_1), player_2, player_1)),
            Return(Int(1))
        ])
    )

    return program

with open('game_approval.teal', 'w') as f:
    compiled = compileTeal(approval_program(), Mode.Application, version=4)
    f.write(compiled)

with open('game_close_out.teal', 'w') as f:
    compiled = compileTeal(close_out_program(), Mode.Application, version=4)
    f.write(compiled)
