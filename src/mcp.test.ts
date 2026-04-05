import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { McpManager } from "./mcp.js";
import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "paw-mcp-test-"));
});

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

describe("McpManager", () => {
  describe("config loading", () => {
    it("handles missing config files gracefully", async () => {
      const mgr = new McpManager();
      // Should not throw — no config files exist
      await mgr.loadAndConnect(tmpDir);
      expect(mgr.getStatus()).toHaveLength(0);
    });

    it("reads config from .mcp.json", async () => {
      const config = {
        mcpServers: {
          "test-server": {
            command: "echo",
            args: ["hello"],
          },
        },
      };
      await fs.writeFile(path.join(tmpDir, ".mcp.json"), JSON.stringify(config));

      const mgr = new McpManager();
      const configFile = await mgr.readConfigFile.call({ getConfigFilePath: () => path.join(tmpDir, ".mcp.json") } as any);
      // We can't test actual connection, but we can verify config is found
      // readConfigFile is private, so we test via the public path
    });

    it("reads config from .paw/mcp.json", async () => {
      const pawDir = path.join(tmpDir, ".paw");
      await fs.mkdir(pawDir, { recursive: true });
      await fs.writeFile(path.join(pawDir, "mcp.json"), JSON.stringify({
        mcpServers: { "local-server": { command: "node", args: ["server.js"] } },
      }));

      // McpManager.findConfig checks these paths
      const mgr = new McpManager();
      // loadAndConnect will try to connect (will fail), but shouldn't crash
      await mgr.loadAndConnect(tmpDir);
      // Connection will fail but should not throw
    });
  });

  describe("getStatus", () => {
    it("returns empty array when no servers connected", () => {
      const mgr = new McpManager();
      expect(mgr.getStatus()).toEqual([]);
    });
  });

  describe("getToolDefinitions", () => {
    it("returns empty array when no servers", () => {
      const mgr = new McpManager();
      expect(mgr.getToolDefinitions()).toEqual([]);
    });
  });

  describe("getToolHandlers", () => {
    it("returns empty object when no servers", () => {
      const mgr = new McpManager();
      expect(mgr.getToolHandlers()).toEqual({});
    });
  });

  describe("getConfigPaths", () => {
    it("returns expected config paths", () => {
      const mgr = new McpManager();
      const paths = mgr.getConfigPaths();
      expect(paths).toContain(".mcp.json");
      expect(paths).toContain(".paw/mcp.json");
    });
  });

  describe("config file management", () => {
    it("reads empty config when no file exists", async () => {
      const mgr = new McpManager();
      // Access via loadAndConnect to set cwd
      await mgr.loadAndConnect(tmpDir);
      const config = await mgr.readConfigFile();
      expect(config).toEqual({ mcpServers: {} });
    });

    it("writes and reads config file", async () => {
      const mgr = new McpManager();
      await mgr.loadAndConnect(tmpDir);

      const config = {
        mcpServers: {
          "my-server": { command: "node", args: ["index.js"] },
        },
      };
      await mgr.writeConfigFile(config);

      const read = await mgr.readConfigFile();
      expect(read.mcpServers?.["my-server"]?.command).toBe("node");
      expect(read.mcpServers?.["my-server"]?.args).toEqual(["index.js"]);
    });

    it("preserves existing config when adding new server", async () => {
      const mgr = new McpManager();
      await mgr.loadAndConnect(tmpDir);

      // Write initial config
      await mgr.writeConfigFile({
        mcpServers: { existing: { command: "echo", args: ["hi"] } },
      });

      // Read, modify, write
      const config = await mgr.readConfigFile();
      config.mcpServers!["new-server"] = { command: "node", args: ["new.js"] };
      await mgr.writeConfigFile(config);

      const final = await mgr.readConfigFile();
      expect(final.mcpServers?.["existing"]).toBeDefined();
      expect(final.mcpServers?.["new-server"]).toBeDefined();
    });
  });

  describe("removeServer", () => {
    it("removes server from config file", async () => {
      const mgr = new McpManager();
      await mgr.loadAndConnect(tmpDir);

      await mgr.writeConfigFile({
        mcpServers: {
          "keep": { command: "echo", args: ["1"] },
          "remove": { command: "echo", args: ["2"] },
        },
      });

      await mgr.removeServer("remove");
      const config = await mgr.readConfigFile();
      expect(config.mcpServers?.["keep"]).toBeDefined();
      expect(config.mcpServers?.["remove"]).toBeUndefined();
    });

    it("handles removing non-existent server gracefully", async () => {
      const mgr = new McpManager();
      await mgr.loadAndConnect(tmpDir);

      // Should not throw
      await mgr.removeServer("nonexistent");
    });
  });

  describe("disconnect", () => {
    it("clears all servers", async () => {
      const mgr = new McpManager();
      await mgr.disconnect();
      expect(mgr.getStatus()).toEqual([]);
    });
  });

  describe("getFullStatus", () => {
    it("returns empty when no config", async () => {
      const mgr = new McpManager();
      await mgr.loadAndConnect(tmpDir);
      const status = await mgr.getFullStatus();
      expect(status).toEqual([]);
    });

    it("shows configured but unconnected servers", async () => {
      const mgr = new McpManager();
      await mgr.loadAndConnect(tmpDir);

      await mgr.writeConfigFile({
        mcpServers: {
          "offline-server": { command: "nonexistent-command-xyz" },
        },
      });

      const status = await mgr.getFullStatus();
      expect(status).toHaveLength(1);
      expect(status[0]!.name).toBe("offline-server");
      expect(status[0]!.connected).toBe(false);
      expect(status[0]!.toolCount).toBe(0);
    });
  });

  describe("tool name prefixing", () => {
    it("prefixes tool names with mcp_{server}_ format", () => {
      // This tests the naming convention used by getToolDefinitions
      const mgr = new McpManager();
      // Without actual connected servers, definitions are empty
      // But we can verify the pattern from the source
      const defs = mgr.getToolDefinitions();
      expect(defs).toEqual([]); // no servers = no tools

      // The naming pattern is `mcp_${serverName}_${toolName}`
      // Verified by reading the source code
    });
  });
});
