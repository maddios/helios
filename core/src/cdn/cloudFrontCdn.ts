import {
	CreateInvalidationCommand,
	ListInvalidationsCommand,
	TooManyInvalidationsInProgress,
	type CloudFrontClient
} from "@aws-sdk/client-cloudfront";
import type { Cdn } from "./types";

const LIST_PAGE_SIZE = 100;

export class CloudFrontCdn implements Cdn {
	constructor(
		private readonly client: CloudFrontClient,
		private readonly distributionId: string
	) {}

	async invalidationsInProgress(): Promise<number> {
		const { InvalidationList } = await this.client.send(
			new ListInvalidationsCommand({ DistributionId: this.distributionId, MaxItems: LIST_PAGE_SIZE })
		);
		return (InvalidationList?.Items ?? []).filter((item) => item.Status === "InProgress").length;
	}

	async createInvalidation(paths: string[], callerReference: string): Promise<boolean> {
		try {
			await this.client.send(
				new CreateInvalidationCommand({
					DistributionId: this.distributionId,
					InvalidationBatch: {
						CallerReference: callerReference,
						Paths: { Quantity: paths.length, Items: paths }
					}
				})
			);
			return true;
		} catch (err) {
			if (err instanceof TooManyInvalidationsInProgress) {
				return false;
			}
			throw err;
		}
	}
}
