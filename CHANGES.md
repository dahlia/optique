Optique changelog
=================

Version 0.2.0
-------------

Released on August 22, 2025.

### @optique/core

 -  Added `concat()` function for concatenating multiple `tuple()` parsers into
    a single flattened tuple, similar to how `merge()` works for `object()`
    parsers. [[#1]]

 -  Fixed an infinite loop issue in the main parsing loop that could occur when
    parsers succeeded but didn't consume input.

 -  Fixed bundled short options (e.g., `-vdf` for `-v -d -f`) not being parsed
    correctly in some cases.

[#1]: https://github.com/dahlia/optique/issues/1


Version 0.1.1
-------------

Released on August 21, 2025.

### @optique/core

 -  Fixed a bug where `object()` parsers containing only Boolean flags would
    fail when no arguments were provided, instead of defaulting the flags to
    `false`. [[#6]]

[#6]: https://github.com/dahlia/optique/issues/6


Version 0.1.0
-------------

Released on August 21, 2025.  Initial release.
