const marshallOptions = {
  // Whether to automatically convert empty strings, blobs, and sets to `null`.
  convertEmptyValues: false, // false, by default.
  // Whether to remove undefined values while marshalling.
  removeUndefinedValues: true, // false, by default.
  // Whether to convert typeof object to map attribute.
  convertClassInstanceToMap: true, // false, by default.
};

const unmarshallOptions = {
  // Whether to return numbers as a string instead of converting them to native JavaScript numbers.
  wrapNumbers: false, // false, by default.
};

export const translateConfig = { marshallOptions, unmarshallOptions };

// Custom marshal function
export function customMarshall(item: any) : any {
  if (item instanceof Date) {
    // Convert Date to Unix timestamp
    return item.getTime();
  } else if (Array.isArray(item)) {
    // Recursively marshal array elements
    return item.map(customMarshall);
  } else if (typeof item === "object" && item !== null) {
    // Recursively marshal object properties
    const marshalledItem: any = {};
    for (const key in item) {
      if (Object.prototype.hasOwnProperty.call(item, key)) {
        marshalledItem[key] = customMarshall(item[key]);
      }
    }
    return marshalledItem;
  } else {
    // Return non-object value as is
    return item;
  }
  // return marshall(item , marshallOptions)
}

// Custom unmarshal function
export function customUnmarshall(item: any, targetClass: any): any {
  if (!item) {
    return null;
  }

  const instance = new targetClass();

  for (const key of Object.keys(item)) {
    const value = item[key];
    const propertyType = Reflect.getMetadata("design:type", instance, key);

    // console.log("Properties for item", propertyType, key, value, JSON.stringify(Reflect.getOwnMetadataKeys(instance)));
    if (propertyType) {
      if (
        propertyType === Date &&
        Reflect.hasMetadata("dynamodb:date-property", instance, key)
      ) {
        // Handle Date properties (timestamps)
        instance[key] = new Date(+value);
      } else if (
        propertyType === Array &&
        Reflect.hasMetadata("dynamodb:list-property", instance, key)
      ) {
        if (Array.isArray(value)) {
          // Get the type of member objects from the decorator
          const memberType = Reflect.getMetadata(
            "dynamodb:list-property",
            instance,
            key
          );

          const v = value.map((i) => {
            return customUnmarshall(i, memberType);
          });
          if (v) {
            instance[key] = [...v];
          }
        }
      } else {
        // Handle other property types
        instance[key] = value;
      }
    }
    else {
      // Handle other property types
      instance[key] = value;
    }
  }
  // console.log("Unmarshalled instance", JSON.stringify(instance));
  return instance;
}
