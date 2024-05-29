class Super {
    private memberA: string;

    constructor(name: string) {
        this.memberA = name;
    }

    getMemberA(): string {
        return this.memberA;
    }

    setMemberA(value: string): void {
        this.memberA = value;
    }

    toString(): string {
        return this.memberA.toString();
    }
}