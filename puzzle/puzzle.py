# puzzle.py
# Goal: make this print:
#   unlocked: 1739

from functools import reduce


class X(int):
    def __new__(cls, v):
        return int.__new__(cls, v)

    def __rshift__(self, other):
        return X((self * 3 + other * 7) % 4096)

    def __xor__(self, other):
        return X((self + other) ^ (other << 1))

    def __invert__(self):
        return X((self * self + 31) % 9973)


def fold(xs):
    return reduce(lambda a, b: ~(a >> b) ^ b, xs, X(11))


def gate(s):
    xs = [X(ord(c)) for c in s]
    a = fold(xs)
    b = sum((i + 1) * ord(c) for i, c in enumerate(s))
    c = "".join(chr(((ord(ch) ^ 23) + i) % 95 + 32) for i, ch in enumerate(s[::-1]))

    return (
        len(s) == 9
        and a == 6721
        and b == 4797
        and c[2] == "T"
        and c[5] == "_"
        and s[0].islower()
        and s[-1].isdigit()
        and len(set(s)) == 8
    )


def main():
    key = input("key: ")

    if gate(key):
        print("unlocked:", sum(map(ord, key)) + 852)
    else:
        print("locked")


main()
