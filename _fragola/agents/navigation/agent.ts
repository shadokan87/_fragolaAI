import { Fragola } from "../../../lib";

const weather = Fragola.createAgent({
    tools: ["weather/*"],
});

export default weather;