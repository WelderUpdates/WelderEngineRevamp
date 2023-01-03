// MIT Licensed (see LICENSE.md).
#pragma once

namespace Zero
{

class MaterialProcessor
{
public:
  MaterialProcessor(MaterialContent* materialContent, String outputPath, String inputFile);

  void ExtractAndImportMaterials(const aiScene* scene);
  void CreateMaterial(aiMaterial* material, uint materialIndex, StringParam extension);

  MaterialContent* mMaterialContent;
  String mOutputPath;
  String mFilename;
};

} // namespace Zero
