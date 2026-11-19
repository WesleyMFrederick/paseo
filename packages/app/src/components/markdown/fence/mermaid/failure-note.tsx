import { Text } from "react-native";
import { useTranslation } from "react-i18next";
import { StyleSheet } from "react-native-unistyles";
import { markdownCopyDataSet } from "@/assistant-selection-copy/markup";
import type { MermaidRenderFailure } from "./render-model";

export function DiagramFailureNote({ failure }: { failure: MermaidRenderFailure }) {
  const { t } = useTranslation();
  return (
    // App chrome, not message content: copying the message leaves it out.
    <Text style={styles.note} dataSet={markdownCopyDataSet.ignore}>
      {failure.line === null
        ? t("message.diagram.renderFailed")
        : t("message.diagram.renderFailedAtLine", { line: failure.line })}
    </Text>
  );
}

const styles = StyleSheet.create((theme) => ({
  note: {
    color: theme.colors.palette.red[300],
    fontSize: theme.fontSize.xs,
    marginTop: theme.spacing[1],
  },
}));
