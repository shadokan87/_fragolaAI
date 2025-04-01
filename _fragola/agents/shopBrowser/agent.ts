import { Fragola } from "../../../lib";

const shopBrowser = Fragola.createAgent({
    tools: ["shopBrowser/*"],
});

export default shopBrowser;