export interface EdgeHeaders {
	[name: string]: { value: string };
}

export interface EdgeRequest {
	method: string;
	uri: string;
	querystring: { [name: string]: { value: string } };
	headers: EdgeHeaders;
}

export interface EdgeResponse {
	statusCode: number;
	statusDescription: string;
	headers: EdgeHeaders;
	body?: { encoding: "text"; data: string };
}

export declare function handler(event: { request: EdgeRequest }): EdgeRequest | EdgeResponse;
