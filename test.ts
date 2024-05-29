class Super {
    private memberA: string;

    constructor(name: string) {
        this.memberA = name;
    }

    get memberA(): string {
        return this.memberA;
    }

    setMemberA(value: string): void {
        this.memberA = value;
    }

    toString(args: any): string {
        return this.memberA.toString(args);
    }
}