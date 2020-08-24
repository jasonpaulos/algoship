from pyteal import *

class Stage:
    placement = Int(0)
    guess = Int(1)
    reveal = Int(2)
    post_reveal = Int(3)
    finished = Int(4)

# constants
grid_size_static = 2
grid_size = Int(grid_size_static)
ships = Int(2)

# global state keys
player_1 = Bytes("p1")
player_2 = Bytes("p2")
awaiting_p2 = Bytes("waiting for p2")
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
        App.globalPut(player_1, Txn.sender()),
        App.globalPut(player_2, Txn.application_args[0]),
        App.globalPut(awaiting_p2, Int(1)),
        App.globalPut(Bytes("grid size"), grid_size),
        App.globalPut(Bytes("num ships"), ships),
        App.localPut(Int(0), need_to_place, Int(1)),
        Return(Int(1))
    ])

    on_delete = Return(And(
        App.globalGet(stage) == Stage.finished,
        Or(
            Txn.sender() == App.globalGet(player_1),
            Txn.sender() == App.globalGet(player_2)
        )
    ))

    on_update = Seq([
        Return(Int(1)) # TODO: change
    ])

    on_closeout = Seq([
        Return(Int(0))
    ])

    on_register = Seq([
        If(Not(App.globalGet(awaiting_p2)),
            Return(Int(0))
        ),
        App.globalDel(awaiting_p2),
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
                App.localPut(Int(0), ships_remaining, ships),
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
        App.localPut(Int(0), App.globalGet(player_guess), Int(0)),
        App.globalPut(stage, Stage.guess),
        App.globalPut(turn, revealer),
        Return(Int(1))
    ])

    reveal_hit = Seq([
        App.localPut(Int(0), App.globalGet(player_guess), Int(1)),
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
    secret_and_0 = Concat(player_secret, Bytes("base64", "AA=="))
    secret_and_1 = Concat(player_secret, Bytes("base64", "AQ=="))
    encrypted_cell = App.localGet(Int(0), App.globalGet(player_guess))
    reveal_stage = Cond(
        [encrypted_cell == Sha256(secret_and_0), reveal_miss],
        [encrypted_cell == Sha256(secret_and_1), reveal_hit]
    )

    all_cells_revealed = And(
        *[Or(App.localGet(Int(0), Itob(Int(i))) == Int(0), App.localGet(Int(0), Itob(Int(i))) == Int(1)) for i in range(grid_size_static)]
    )

    revealed_index = Txn.application_args[1] # as bytes
    encrypted_cell_from_revealed_index = App.localGet(Int(0), revealed_index)
    revealed_cell = Cond(
        [encrypted_cell_from_revealed_index == Sha256(secret_and_0), Int(0)],
        [encrypted_cell_from_revealed_index == Sha256(secret_and_1), Int(1)]
    )
    post_reveal_stage = Seq([
        Assert(App.localGet(Int(0), placement) == Int(0)),
        App.localPut(Int(0), revealed_index, revealed_cell),
        If(all_cells_revealed, 
            Seq([
                App.localPut(Int(0), placement, Int(1)), # TODO: verify placement
                If(App.globalGet(num_revealed) == Int(0),
                    App.globalPut(num_revealed, Int(1)),
                    App.globalPut(stage, Stage.finished)
                )
            ])
        ),
        Return(Btoi(revealed_index) < grid_size * grid_size)
    ])

    program = Cond(
        [Txn.application_id() == Int(0), on_creation],
        [Txn.on_completion() == OnComplete.DeleteApplication, on_delete],
        [Txn.on_completion() == OnComplete.UpdateApplication, on_update],
        [Txn.on_completion() == OnComplete.CloseOut, on_closeout],
        [Txn.on_completion() == OnComplete.OptIn, on_register],
        [App.globalGet(stage) == Stage.placement, placement_stage],
        [App.globalGet(stage) == Stage.guess, guess_stage],
        [App.globalGet(stage) == Stage.reveal, reveal_stage],
        [App.globalGet(stage) == Stage.post_reveal, post_reveal_stage]
    )

    return program

def close_out_program():
    # TODO
    return Int(1)

with open('game_approval.teal', 'w') as f:
    compiled = compileTeal(approval_program(), Mode.Application)
    f.write(compiled)

with open('game_close_out.teal', 'w') as f:
    compiled = compileTeal(close_out_program(), Mode.Application)
    f.write(compiled)
