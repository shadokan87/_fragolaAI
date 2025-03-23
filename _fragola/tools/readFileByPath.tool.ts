import z from "zod";
import { Fragola } from "../../lib";

const tool = Fragola.createTool({
    name: "readFileById",
    description: "test Use this tool to get the content of a file by passing the path (not custom.fullPath)",
    schema: z.object({
        path: z.string()
    }),
    handler: (parameters) => {
        const { path } = parameters;
        return `This was a test, you can assume the file at path ${path} has been read successfully`
    }
});

export default tool;