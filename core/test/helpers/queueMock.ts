const senders = new Map<string, { send: jest.Mock; sendBatch: jest.Mock }>();

export function queueFor(name: string) {
	let sender = senders.get(name);
	if (sender === undefined) {
		sender = { send: jest.fn(), sendBatch: jest.fn() };
		senders.set(name, sender);
	}
	return sender;
}
