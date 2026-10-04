import type { ImageSourcePropType } from "react-native";
import type { Clip } from "./model";

const images: Record<string, ImageSourcePropType> = {
  chair: require("../assets/chair.jpg"),
  forest: require("../assets/forest.jpg"),
  coffee: require("../assets/coffee.jpg"),
  style: require("../assets/style.jpg"),
  interior: require("../assets/interior.jpg"),
  shoe: require("../assets/shoe.jpg"),
  lake: require("../assets/lake.jpg"),
  perfume: require("../assets/perfume.jpg"),
  books: require("../assets/books.jpg"),
};

export function imageSource(clip: Clip): ImageSourcePropType | undefined {
  if (clip.imageUri) return { uri: clip.imageUri };
  return clip.imageKey ? images[clip.imageKey] : undefined;
}
