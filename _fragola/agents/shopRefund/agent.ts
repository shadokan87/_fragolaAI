import { Fragola } from "../../../lib";

const shopRefund = Fragola.createAgent({
    tools: ["shopBrowser/*"],
});

export default shopRefund;