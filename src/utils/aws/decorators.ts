import "reflect-metadata";

export function DynamoDBDateProperty(): PropertyDecorator {
  return Reflect.metadata("dynamodb:date-property", true);
}

export function DynamoDBListProperty(type: { new(): any }): PropertyDecorator {
  return Reflect.metadata("dynamodb:list-property", type);
}
