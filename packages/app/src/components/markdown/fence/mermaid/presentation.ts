import type { TextStyle, ViewStyle } from "react-native";

export function getDiagramBoxStyle(style: TextStyle): ViewStyle {
  return {
    backgroundColor: style.backgroundColor,
    borderColor: style.borderColor,
    borderRadius: style.borderRadius,
    borderWidth: style.borderWidth,
    marginBottom: style.marginBottom,
    marginTop: style.marginTop,
    marginVertical: style.marginVertical,
    padding: style.padding,
  };
}

// Moves the fence's vertical margins onto a wrapper so content placed under the
// code block sits inside the same gap.
export function splitFenceMargins(style: TextStyle): { margins: ViewStyle; text: TextStyle } {
  const { marginTop, marginBottom, marginVertical, ...text } = style;
  return {
    margins: {
      marginTop: marginTop ?? marginVertical,
      marginBottom: marginBottom ?? marginVertical,
    },
    text,
  };
}
