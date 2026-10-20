import fs from "node:fs";
import path from "node:path";
import yaml from "js-yaml";
import { EDGE_RESPONSE_HEADERS } from "../../core/src/cdn/responseHeaders";
import { renderCdnTemplate } from "../infra/inlineEdgeFunction";

const ROOT = path.resolve(__dirname, "../..");
const INTRINSICS = ["Ref", "Sub", "GetAtt", "If", "Not", "Equals", "Select", "Split", "Join"];
const SCHEMA = yaml.DEFAULT_SCHEMA.extend(
	INTRINSICS.flatMap((name) =>
		(["scalar", "sequence", "mapping"] as const).map(
			(kind) =>
				new yaml.Type(`!${name}`, {
					kind,
					construct: (data: unknown) => ({ [name === "Ref" ? "Ref" : `Fn::${name}`]: data })
				})
		)
	)
);

type Node = Record<string, unknown>;

function loadTemplate(text: string): Node {
	return yaml.load(text, { schema: SCHEMA }) as Node;
}

function resourcesOfType(template: Node, type: string): Record<string, Node> {
	const resources = template.Resources as Record<string, Node>;
	return Object.fromEntries(Object.entries(resources).filter(([, resource]) => resource.Type === type));
}

function singleResource(template: Node, type: string): Node {
	const [resource] = Object.values(resourcesOfType(template, type));
	if (resource === undefined) {
		throw new Error(`No resource of type ${type}`);
	}
	return resource.Properties as Node;
}

describe("renderCdnTemplate", () => {
	it("replaces the placeholder line with the edge source at the same indentation", () => {
		const rendered = renderCdnTemplate(
			"A:\n    Code: |\n        __IMG_REWRITE_SOURCE__\nB: 1\n",
			"function f() {\n\n  return 1;\n}\n"
		);

		expect(rendered).toBe("A:\n    Code: |\n        function f() {\n\n          return 1;\n        }\nB: 1\n");
	});

	it("throws when the placeholder is missing", () => {
		expect(() => renderCdnTemplate("A: 1\n", "x")).toThrow("Expected exactly one");
	});
});

describe("infra/cdn.yml", () => {
	const edgeSource = fs.readFileSync(path.join(ROOT, "infra", "edge", "imgRewrite.js"), "utf8");
	const template = loadTemplate(
		renderCdnTemplate(fs.readFileSync(path.join(ROOT, "infra", "cdn.yml"), "utf8"), edgeSource)
	);
	const distribution = singleResource(template, "AWS::CloudFront::Distribution");
	const config = distribution.DistributionConfig as Node;

	it("declares the parameters and outputs", () => {
		expect(Object.keys(template.Parameters as Node)).toEqual(
			expect.arrayContaining([
				"Stage",
				"MediaBucketName",
				"ImageFunctionArn",
				"ImageFunctionUrl",
				"PriceClass",
				"Aliases",
				"CertificateArn"
			])
		);
		expect(Object.keys(template.Outputs as Node)).toEqual(["DistributionId", "DomainName"]);
	});

	it("sends the same security headers as the local edge, on the default and the image behaviors", () => {
		const policy = singleResource(template, "AWS::CloudFront::ResponseHeadersPolicy")
			.ResponseHeadersPolicyConfig as Node;
		const headers = policy.SecurityHeadersConfig as Node;
		const custom = (policy.CustomHeadersConfig as { Items: { Header: string; Value: string }[] }).Items;
		const sent = {
			"X-Content-Type-Options": "nosniff",
			"Content-Security-Policy": (headers.ContentSecurityPolicy as Node).ContentSecurityPolicy,
			...Object.fromEntries(custom.map(({ Header, Value }) => [Header, Value]))
		};
		expect(sent).toEqual(EDGE_RESPONSE_HEADERS);

		const policyId = { Ref: "ResponseHeadersPolicy" };
		expect(config.DefaultCacheBehavior).toMatchObject({ ResponseHeadersPolicyId: policyId });
		expect((config.CacheBehaviors as Node[])[0]).toMatchObject({ ResponseHeadersPolicyId: policyId });
	});

	it("inlines the edge function source into the rewrite function", () => {
		const functionProps = singleResource(template, "AWS::CloudFront::Function");
		expect((functionProps.FunctionCode as string).trim()).toBe(edgeSource.trim());
	});

	it("signs both origins with OAC, S3 with sigv4 always and Lambda as a lambda origin", () => {
		const oacs = Object.values(resourcesOfType(template, "AWS::CloudFront::OriginAccessControl")).map(
			(resource) => resource.Properties as Node
		);
		const configs = oacs.map((oac) => oac.OriginAccessControlConfig as Node);
		expect(configs.map((c) => c.OriginAccessControlOriginType).sort()).toEqual(["lambda", "s3"]);
		expect(configs.every((c) => c.SigningBehavior === "always" && c.SigningProtocol === "sigv4")).toBe(true);
	});

	it("routes /img/* through an origin group with S3 variants first and the image Lambda on 403 or 404", () => {
		const group = (config.OriginGroups as Node & { Items: Node[] }).Items[0];
		expect((group.FailoverCriteria as Node).StatusCodes).toEqual({ Quantity: 2, Items: [403, 404] });
		expect((group.Members as Node).Items).toEqual([{ OriginId: "mediaVariants" }, { OriginId: "imageLambda" }]);
		const origins = config.Origins as Node[];
		expect(origins.find((origin) => origin.Id === "mediaVariants")?.OriginPath).toBe("/resize_cache");
		expect(origins.find((origin) => origin.Id === "imageLambda")?.OriginAccessControlId).toEqual({
			Ref: "ImageOriginAccessControl"
		});
	});

	it("attaches the rewrite function as a viewer-request function on the img behavior", () => {
		const behavior = (config.CacheBehaviors as Node[])[0];
		expect(behavior.PathPattern).toBe("img/*");
		expect(behavior.TargetOriginId).toBe("imageGroup");
		expect(behavior.FunctionAssociations).toEqual([
			{
				EventType: "viewer-request",
				FunctionARN: { "Fn::GetAtt": "ImageRewriteFunction.FunctionMetadata.FunctionARN" }
			}
		]);
	});

	it("keys the cache on the v query string only, with no headers or cookies", () => {
		const policy = singleResource(template, "AWS::CloudFront::CachePolicy").CachePolicyConfig as Node;
		const parameters = policy.ParametersInCacheKeyAndForwardedToOrigin as Node;
		expect(parameters.QueryStringsConfig).toEqual({ QueryStringBehavior: "whitelist", QueryStrings: ["v"] });
		expect(parameters.HeadersConfig).toEqual({ HeaderBehavior: "none" });
		expect(parameters.CookiesConfig).toEqual({ CookieBehavior: "none" });
	});

	it("lets only this distribution read the media bucket", () => {
		const policy = singleResource(template, "AWS::S3::BucketPolicy").PolicyDocument as Node;
		const [statement] = policy.Statement as Node[];
		expect(statement.Principal).toEqual({ Service: "cloudfront.amazonaws.com" });
		expect(statement.Action).toBe("s3:GetObject");
		expect(statement.Resource).toEqual([
			{ "Fn::Sub": "arn:${AWS::Partition}:s3:::${MediaBucketName}/*/media/*" },
			{ "Fn::Sub": "arn:${AWS::Partition}:s3:::${MediaBucketName}/*/files/*" },
			{ "Fn::Sub": "arn:${AWS::Partition}:s3:::${MediaBucketName}/resize_cache/*" }
		]);
		expect(statement.Condition).toEqual({
			StringEquals: {
				"AWS:SourceArn": {
					"Fn::Sub": "arn:${AWS::Partition}:cloudfront::${AWS::AccountId}:distribution/${Distribution}"
				}
			}
		});
	});

	it("lets the distribution invoke the image Lambda through its Function URL and directly", () => {
		const permissions = Object.values(resourcesOfType(template, "AWS::Lambda::Permission")).map(
			(resource) => resource.Properties as Node
		);
		const sourceArn = {
			"Fn::Sub": "arn:${AWS::Partition}:cloudfront::${AWS::AccountId}:distribution/${Distribution}"
		};
		expect(permissions).toEqual([
			expect.objectContaining({
				Action: "lambda:InvokeFunctionUrl",
				FunctionUrlAuthType: "AWS_IAM",
				Principal: "cloudfront.amazonaws.com",
				SourceArn: sourceArn
			}),
			expect.objectContaining({
				Action: "lambda:InvokeFunction",
				Principal: "cloudfront.amazonaws.com",
				SourceArn: sourceArn
			})
		]);
	});

	it("uses the default certificate unless an alias certificate is given", () => {
		expect(config.ViewerCertificate).toEqual({
			"Fn::If": [
				"HasCertificate",
				{
					AcmCertificateArn: { Ref: "CertificateArn" },
					SslSupportMethod: "sni-only",
					MinimumProtocolVersion: "TLSv1.2_2021"
				},
				{ CloudFrontDefaultCertificate: true }
			]
		});
	});
});
