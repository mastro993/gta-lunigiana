# Grand Theft Auto: Lunigiana

An open-world crime action game in the style of Grand Theft Auto, set on a real map of Lunigiana built from open survey data. These are the project's own words; `docs/` says how each thing behaves.

## Map build

**Bake**:
A table the map build works out by running the game's own code on the provisional map, because it reads what the game holds only near the player; the provisional map leaves it empty. A bake reads the provisional map and the whole map's vectors, never another bake (the farms' building centres are part of the farms bake).
_Avoid_: derived (the global file's table for readers far from the player, which also holds copies that are not bakes), precompute, cache

**Provisional map**:
The map as cut, with every bake still empty, handed to the game's code during the build so the bakes can run on it.
_Avoid_: draft map, unbaked map, partial map

## Standing and rolling

**Footing**:
The ground under a person or an animal, on the level it is on: a bridge's deck, a tunnel's floor, a platform or the ground at grade. On foot it is what they stand on; for the player driving, the ground under the vehicle or train they drive. Every person and animal always has one.
_Avoid_: level (reserved for whether two things meet), standing height, ground (for a body on foot)

**Wheels' ground**:
The ground a vehicle's wheels stand on, on the level it rolls on; the vehicle's counterpart of a footing.
_Avoid_: vehicle level, chassis height

## Meeting

**Level**:
The height a body or a wall is judged at when it meets another, m a.s.l.: a person's or an animal's footing, a vehicle's wheels' ground (pitched), a train car's rail head, a wall's own. Bridges, underpasses and tunnels put several levels over one point of the map.
_Avoid_: height, z, elevation, floor

**On one level**:
Two levels standing within 2 m of each other. Bodies meet, and a wall stops a body, only on one level.
_Avoid_: same height, same floor, level with

**Meet**:
What two bodies on one level can do at a point: touch, see or scare each other, get in. Bodies not on one level pass as if the other were not there.
_Avoid_: collide (only one kind of meeting), interact

**Point level**:
A level taken as one height over the whole body: a person's, an animal's, a train car's, a wall's.

**Pitched level**:
A road vehicle's level: its wheels' ground under its middle, rising or falling along its axis with its pitch, so its two ends can stand metres apart on a steep lane.

**Level toward a point**:
A road vehicle's level as read toward a point: along its pitch out to its bumpers, and past a bumper rolled on over the ground along its heading, as its wheels would find their way onto a deck or into a tunnel. Never read sideways: the ground beside a vehicle is not what it stands on.
