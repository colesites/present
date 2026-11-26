"use client";

import { BookOpen, Music2 } from "lucide-react";
import type { ReactNode } from "react";
import { Segmented } from "../../../renderer/shared/components/style-controls";
import { SETTINGS_LANGUAGE_OPTIONS, type AgentSettings as AgentSettingsValue } from "../lib/constants";
import {
  SettingsButton,
  SettingsGroup,
  SettingsPage,
  SettingsRow,
  SettingsSelect,
  SettingsSwitch,
} from "./settings-ui";

/** An agent's name, with the mark it has elsewhere in the app. */
function AgentTitle({ icon, children }: { icon: ReactNode; children: ReactNode }) {
  return (
    <span className="flex items-center gap-2">
      <span className="flex h-5 w-5 items-center justify-center rounded-md bg-primary/12 text-primary">{icon}</span>
      {children}
    </span>
  );
}

export function AgentSettings({
  lang,
  onLangChange,
  microphoneLabel,
  onChooseMicrophone,
  agent,
  onAgentChange,
}: {
  lang: string;
  onLangChange: (lang: string) => void;
  /** The microphone chosen in Audio. */
  microphoneLabel: string;
  onChooseMicrophone: () => void;
  agent: AgentSettingsValue;
  onAgentChange: (patch: Partial<AgentSettingsValue>) => void;
}) {
  return (
    <SettingsPage
      title="Agent"
      description="The agents listen during a service and keep the screen with what is being said and sung."
    >
      <SettingsGroup title="Listening" description="Both agents hear through the same microphone.">
        <SettingsRow label="Language" description="The language and accent they expect to hear.">
          <SettingsSelect
            label="Language"
            value={lang}
            onChange={onLangChange}
            options={SETTINGS_LANGUAGE_OPTIONS}
          />
        </SettingsRow>
        <SettingsRow label="Microphone" description={`${microphoneLabel}. Chosen in Audio, with the outputs.`}>
          <SettingsButton onClick={onChooseMicrophone}>Choose…</SettingsButton>
        </SettingsRow>
      </SettingsGroup>

      <SettingsGroup
        title={<AgentTitle icon={<BookOpen className="h-3 w-3" />}>Bible agent</AgentTitle>}
        description='Hears a reference, like "turn with me to John 3:16", and finds it. Switch it on with the microphone in the Bible tab.'
      >
        <SettingsRow
          label="When it hears a passage"
          description={
            agent.bibleOnHeard === "show"
              ? "It goes straight on screen when it is sure. When it is not — the first words of a verse — it waits in the Bible tab for you to show."
              : "It opens in the Bible tab, ready for you to show."
          }
        >
          <Segmented
            label="When it hears a passage"
            value={agent.bibleOnHeard}
            onChange={(value) => onAgentChange({ bibleOnHeard: value === "find" ? "find" : "show" })}
            className="w-[200px]"
            options={[
              { value: "show", label: "Show it" },
              { value: "find", label: "Find it" },
            ]}
          />
        </SettingsRow>
        <SettingsRow
          label="Add it to the service"
          description="A passage that goes on screen is added to the open service."
          disabled={agent.bibleOnHeard === "find"}
        >
          <SettingsSwitch
            label="Add heard passages to the service"
            checked={agent.bibleAddToService}
            disabled={agent.bibleOnHeard === "find"}
            onChange={(checked) => onAgentChange({ bibleAddToService: checked })}
          />
        </SettingsRow>
        <SettingsRow
          label="Voice commands"
          description='"Next verse" and "previous verse" move the passage on screen.'
        >
          <SettingsSwitch
            label="Voice commands"
            checked={agent.bibleVoiceCommands}
            onChange={(checked) => onAgentChange({ bibleVoiceCommands: checked })}
          />
        </SettingsRow>
      </SettingsGroup>

      <SettingsGroup
        title={<AgentTitle icon={<Music2 className="h-3 w-3" />}>Song agent</AgentTitle>}
        description="Listens to the singing. Switch it on from the bar under the slides in Show. Included with Pro and Power."
      >
        <SettingsRow label="Follow the song" description="Moves the slides along as each part is sung.">
          <SettingsSwitch
            label="Follow the song"
            checked={agent.songFollow}
            onChange={(checked) => onAgentChange({ songFollow: checked })}
          />
        </SettingsRow>
        <SettingsRow
          label="Change on the last word"
          description="Shows the next slide as the last word of this one is sung, without waiting for the next line. If the band goes somewhere else, it moves to the right slide as soon as they sing it."
        >
          <SettingsSwitch
            label="Change on the last word"
            checked={agent.songEarly}
            onChange={(checked) => onAgentChange({ songEarly: checked })}
          />
        </SettingsRow>
        <SettingsRow
          label="Pick out the voices"
          description="Turns the drums, keys and backing track down on this computer, so the agent hears the singers' words."
        >
          <SettingsSwitch
            label="Pick out the voices"
            checked={agent.songVoiceFilter}
            onChange={(checked) => onAgentChange({ songVoiceFilter: checked })}
          />
        </SettingsRow>
        <SettingsRow
          label="Hear through the band"
          description="Listens a second time with a model that picks the voice out of the drums and backing track. Its words come a second or two later, so it catches the slide up when the band covered the words."
        >
          <SettingsSwitch
            label="Hear through the band"
            checked={agent.songThrough}
            onChange={(checked) => onAgentChange({ songThrough: checked })}
          />
        </SettingsRow>
        <SettingsRow
          label="Find other songs"
          description="When the band starts a song that isn't on screen, it finds it in the service or your library."
        >
          <SettingsSwitch
            label="Find other songs"
            checked={agent.songSuggest}
            onChange={(checked) => onAgentChange({ songSuggest: checked })}
          />
        </SettingsRow>
        <SettingsRow
          label="Put it up by itself"
          description="When it's plain which song the band is singing, it puts it up. When it isn't sure, it asks you."
        >
          <SettingsSwitch
            label="Put it up by itself"
            checked={agent.songSuggest && agent.songSwitch}
            disabled={!agent.songSuggest}
            onChange={(checked) => onAgentChange({ songSwitch: checked })}
          />
        </SettingsRow>
      </SettingsGroup>
    </SettingsPage>
  );
}
