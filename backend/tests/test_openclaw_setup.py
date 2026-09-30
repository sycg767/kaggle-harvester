import importlib.util
import json
import tempfile
import unittest
from pathlib import Path

SPEC = importlib.util.spec_from_file_location("setup_openclaw", Path(__file__).resolve().parents[2] / "scripts" / "setup_openclaw.py")
setup = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(setup)


class OpenClawSetupTests(unittest.TestCase):
    def test_existing_config_sessions_custom_soul_and_idempotency(self):
        with tempfile.TemporaryDirectory() as tmp:
            home = Path(tmp)
            root = home / ".openclaw"
            workspace = root / "workspace"
            workspace.mkdir(parents=True)
            config = {"gateway": {"bind": "loopback", "auth": {"token": "original"}},
                      "models": {"providers": {"mine": {"apiKey": "existing"}}},
                      "tools": {"deny": ["exec"]}, "agents": {"list": [{"id": "custom"}]}}
            (root / "openclaw.json").write_text(json.dumps(config), encoding="utf-8")
            (workspace / "SOUL.md").write_text("My custom instructions\n", encoding="utf-8")
            (workspace / "MEMORY.md").write_text("Keep me", encoding="utf-8")
            session = root / "agents" / "main" / "sessions"
            session.mkdir(parents=True)
            (session / "conversation.json").write_text("{}", encoding="utf-8")
            self.assertTrue(setup.setup_openclaw(home=home, repo=home / "chosen", env={}))
            new = json.loads((root / "openclaw.json").read_text(encoding="utf-8"))
            for key in ["models", "tools", "agents"]:
                self.assertEqual(new[key], config[key])
            self.assertEqual(new["gateway"]["auth"], config["gateway"]["auth"])
            soul = (workspace / "SOUL.md").read_text(encoding="utf-8")
            self.assertIn("My custom instructions", soul)
            self.assertIn(str(home / "chosen"), soul)
            self.assertIn("--refresh", soul)
            self.assertTrue((session / "conversation.json").exists())
            self.assertEqual((workspace / "MEMORY.md").read_text(), "Keep me")
            backup = (root / "openclaw.json.pre-managed.bak").read_bytes()
            self.assertFalse(setup.setup_openclaw(home=home, repo=home / "chosen", env={}))
            self.assertEqual(backup, (root / "openclaw.json.pre-managed.bak").read_bytes())

    def test_corrupt_config_is_not_overwritten(self):
        with tempfile.TemporaryDirectory() as tmp:
            home = Path(tmp)
            root = home / ".openclaw"
            root.mkdir()
            path = root / "openclaw.json"
            path.write_text("broken{", encoding="utf-8")
            with self.assertRaises(ValueError):
                setup.setup_openclaw(home=home, env={})
            self.assertEqual(path.read_text(), "broken{")
            self.assertFalse((root / "workspace").exists())

    def test_explicit_env_file_and_provider_merge(self):
        with tempfile.TemporaryDirectory() as tmp:
            home = Path(tmp)
            env_file = home / "selected.env"
            env_file.write_text("OPENCLAW_LLM_API_KEY=test-key\nOPENCLAW_LLM_MODEL=selected-model\n", encoding="utf-8")
            setup.setup_openclaw(home=home, env={"COMPOSE_ENV_FILE": str(env_file)})
            cfg = json.loads((home / ".openclaw" / "openclaw.json").read_text(encoding="utf-8"))
            self.assertEqual(cfg["agents"]["defaults"]["model"]["primary"], "tokenrhythm/selected-model")
            cfg["models"]["providers"]["other"] = {"apiKey": "other"}
            cfg["agents"]["defaults"]["model"]["fallbacks"] = ["other/model"]
            setup.merge_config(cfg, {"OPENCLAW_LLM_API_KEY": "new", "OPENCLAW_LLM_MODEL": "new-model"})
            self.assertEqual(cfg["models"]["providers"]["other"], {"apiKey": "other"})
            self.assertEqual(cfg["agents"]["defaults"]["model"]["fallbacks"], ["other/model"])

    def test_malformed_managed_section_is_not_overwritten(self):
        with self.assertRaises(ValueError):
            setup.merge_soul("custom\n" + setup.BEGIN, "new")
        custom = "User notes\n" + setup.BEGIN + "\nold\n" + setup.END + "\nMore notes"
        merged = setup.merge_soul(custom, "new")
        self.assertTrue(merged.startswith("User notes\n"))
        self.assertTrue(merged.endswith("\nMore notes"))
        self.assertNotIn("\nold\n", merged)


if __name__ == "__main__":
    unittest.main()
