import path from "node:path";
import { fileURLToPath } from "node:url";
import { Generator, getConfig } from "@tanstack/router-generator";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const config = await getConfig(
  {
    target: "react",
    routesDirectory: path.join(root, "src/routes"),
    generatedRouteTree: path.join(root, "src/routeTree.gen.ts"),
    autoCodeSplitting: true,
  },
  root,
);

const generator = new Generator({ config, root });
await generator.run();
console.log("routeTree.gen.ts generated");
