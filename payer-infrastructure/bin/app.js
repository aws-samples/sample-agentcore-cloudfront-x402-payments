#!/usr/bin/env node
"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
require("source-map-support/register");
const cdk = __importStar(require("aws-cdk-lib"));
const agentcore_stack_1 = require("../lib/agentcore-stack");
const observability_stack_1 = require("../lib/observability-stack");
const app = new cdk.App();
// Main AgentCore infrastructure stack
new agentcore_stack_1.AgentCoreStack(app, 'X402PayerAgentStack', {
    env: {
        account: process.env.CDK_DEFAULT_ACCOUNT,
        region: process.env.CDK_DEFAULT_REGION || 'us-west-2',
    },
    description: 'x402 Payer Agent - Bedrock AgentCore infrastructure',
});
// Observability stack with CloudWatch dashboards
new observability_stack_1.ObservabilityStack(app, 'X402ObservabilityStack', {
    env: {
        account: process.env.CDK_DEFAULT_ACCOUNT,
        region: process.env.CDK_DEFAULT_REGION || 'us-west-2',
    },
    description: 'x402 Enterprise Demo - CloudWatch Observability Dashboards',
    // These can be overridden via context or environment variables
    cloudfrontDistributionId: app.node.tryGetContext('cloudfrontDistributionId'),
    gatewayLogGroupName: app.node.tryGetContext('gatewayLogGroupName'),
});
app.synth();
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiYXBwLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiYXBwLnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiI7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7OztBQUNBLHVDQUFxQztBQUNyQyxpREFBbUM7QUFDbkMsNERBQXdEO0FBQ3hELG9FQUFnRTtBQUVoRSxNQUFNLEdBQUcsR0FBRyxJQUFJLEdBQUcsQ0FBQyxHQUFHLEVBQUUsQ0FBQztBQUUxQixzQ0FBc0M7QUFDdEMsSUFBSSxnQ0FBYyxDQUFDLEdBQUcsRUFBRSxxQkFBcUIsRUFBRTtJQUM3QyxHQUFHLEVBQUU7UUFDSCxPQUFPLEVBQUUsT0FBTyxDQUFDLEdBQUcsQ0FBQyxtQkFBbUI7UUFDeEMsTUFBTSxFQUFFLE9BQU8sQ0FBQyxHQUFHLENBQUMsa0JBQWtCLElBQUksV0FBVztLQUN0RDtJQUNELFdBQVcsRUFBRSxxREFBcUQ7Q0FDbkUsQ0FBQyxDQUFDO0FBRUgsaURBQWlEO0FBQ2pELElBQUksd0NBQWtCLENBQUMsR0FBRyxFQUFFLHdCQUF3QixFQUFFO0lBQ3BELEdBQUcsRUFBRTtRQUNILE9BQU8sRUFBRSxPQUFPLENBQUMsR0FBRyxDQUFDLG1CQUFtQjtRQUN4QyxNQUFNLEVBQUUsT0FBTyxDQUFDLEdBQUcsQ0FBQyxrQkFBa0IsSUFBSSxXQUFXO0tBQ3REO0lBQ0QsV0FBVyxFQUFFLDREQUE0RDtJQUN6RSwrREFBK0Q7SUFDL0Qsd0JBQXdCLEVBQUUsR0FBRyxDQUFDLElBQUksQ0FBQyxhQUFhLENBQUMsMEJBQTBCLENBQUM7SUFDNUUsbUJBQW1CLEVBQUUsR0FBRyxDQUFDLElBQUksQ0FBQyxhQUFhLENBQUMscUJBQXFCLENBQUM7Q0FDbkUsQ0FBQyxDQUFDO0FBRUgsR0FBRyxDQUFDLEtBQUssRUFBRSxDQUFDIiwic291cmNlc0NvbnRlbnQiOlsiIyEvdXNyL2Jpbi9lbnYgbm9kZVxuaW1wb3J0ICdzb3VyY2UtbWFwLXN1cHBvcnQvcmVnaXN0ZXInO1xuaW1wb3J0ICogYXMgY2RrIGZyb20gJ2F3cy1jZGstbGliJztcbmltcG9ydCB7IEFnZW50Q29yZVN0YWNrIH0gZnJvbSAnLi4vbGliL2FnZW50Y29yZS1zdGFjayc7XG5pbXBvcnQgeyBPYnNlcnZhYmlsaXR5U3RhY2sgfSBmcm9tICcuLi9saWIvb2JzZXJ2YWJpbGl0eS1zdGFjayc7XG5cbmNvbnN0IGFwcCA9IG5ldyBjZGsuQXBwKCk7XG5cbi8vIE1haW4gQWdlbnRDb3JlIGluZnJhc3RydWN0dXJlIHN0YWNrXG5uZXcgQWdlbnRDb3JlU3RhY2soYXBwLCAnWDQwMlBheWVyQWdlbnRTdGFjaycsIHtcbiAgZW52OiB7XG4gICAgYWNjb3VudDogcHJvY2Vzcy5lbnYuQ0RLX0RFRkFVTFRfQUNDT1VOVCxcbiAgICByZWdpb246IHByb2Nlc3MuZW52LkNES19ERUZBVUxUX1JFR0lPTiB8fCAndXMtd2VzdC0yJyxcbiAgfSxcbiAgZGVzY3JpcHRpb246ICd4NDAyIFBheWVyIEFnZW50IC0gQmVkcm9jayBBZ2VudENvcmUgaW5mcmFzdHJ1Y3R1cmUnLFxufSk7XG5cbi8vIE9ic2VydmFiaWxpdHkgc3RhY2sgd2l0aCBDbG91ZFdhdGNoIGRhc2hib2FyZHNcbm5ldyBPYnNlcnZhYmlsaXR5U3RhY2soYXBwLCAnWDQwMk9ic2VydmFiaWxpdHlTdGFjaycsIHtcbiAgZW52OiB7XG4gICAgYWNjb3VudDogcHJvY2Vzcy5lbnYuQ0RLX0RFRkFVTFRfQUNDT1VOVCxcbiAgICByZWdpb246IHByb2Nlc3MuZW52LkNES19ERUZBVUxUX1JFR0lPTiB8fCAndXMtd2VzdC0yJyxcbiAgfSxcbiAgZGVzY3JpcHRpb246ICd4NDAyIEVudGVycHJpc2UgRGVtbyAtIENsb3VkV2F0Y2ggT2JzZXJ2YWJpbGl0eSBEYXNoYm9hcmRzJyxcbiAgLy8gVGhlc2UgY2FuIGJlIG92ZXJyaWRkZW4gdmlhIGNvbnRleHQgb3IgZW52aXJvbm1lbnQgdmFyaWFibGVzXG4gIGNsb3VkZnJvbnREaXN0cmlidXRpb25JZDogYXBwLm5vZGUudHJ5R2V0Q29udGV4dCgnY2xvdWRmcm9udERpc3RyaWJ1dGlvbklkJyksXG4gIGdhdGV3YXlMb2dHcm91cE5hbWU6IGFwcC5ub2RlLnRyeUdldENvbnRleHQoJ2dhdGV3YXlMb2dHcm91cE5hbWUnKSxcbn0pO1xuXG5hcHAuc3ludGgoKTtcbiJdfQ==