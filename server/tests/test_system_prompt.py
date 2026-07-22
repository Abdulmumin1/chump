from chump_server.system_prompt import SYSTEM_PROMPT


def test_system_prompt_does_not_tell_agent_to_find_instruction_files() -> None:
    assert "instructions are already loaded" in SYSTEM_PROMPT
    assert "don't search the filesystem" in SYSTEM_PROMPT
    assert "`find`" not in SYSTEM_PROMPT
