import { objectStore } from "@helios/core";

export function mockObjectStore(): void {
	const store = objectStore();
	jest.spyOn(store, "headObject").mockResolvedValue(true);
	jest.spyOn(store, "presignGet").mockResolvedValue("https://signed.test/source.mp4");
	jest.spyOn(store, "presignPut").mockResolvedValue("https://signed.test/put");
	jest.spyOn(store, "presignPart").mockResolvedValue("https://signed.test/part");
	jest.spyOn(store, "createMultipartUpload").mockResolvedValue("upload-1");
	jest.spyOn(store, "completeMultipartUpload").mockResolvedValue();
	jest.spyOn(store, "abortMultipartUpload").mockResolvedValue();
	jest.spyOn(store, "listParts").mockResolvedValue([]);
}
